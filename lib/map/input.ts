import type { MapState, MapConfig } from './types';
import { worldScale } from './geo';

type Cleanup = () => void;

export interface InputCallbacks {
  onTap?: (screenX: number, screenY: number) => void;
}

const TAP_THRESHOLD = 6;

/** Attach all input handlers to the canvas. Returns a cleanup function. */
export function attachInputHandlers(
  canvas: HTMLCanvasElement,
  state: MapState,
  config: MapConfig,
  callbacks: InputCallbacks = {},
): Cleanup {
  const cleanups: Cleanup[] = [];

  function on<K extends keyof HTMLElementEventMap>(
    el: HTMLCanvasElement | Window,
    evt: K,
    fn: (e: HTMLElementEventMap[K]) => void,
    opts?: AddEventListenerOptions,
  ) {
    el.addEventListener(evt, fn as EventListener, opts);
    cleanups.push(() => el.removeEventListener(evt, fn as EventListener, opts));
  }

  // ─── Shared state ──────────────────────────────────────────────
  let pinching = false;
  let pinchDist = 0;
  let pinchMidX = 0;
  let pinchMidY = 0;
  let pinchZoomStart = 0;

  // ─── Pointer (single finger drag / mouse) ─────────────────────
  on(canvas, 'pointerdown', (e) => {
    if (pinching) return;
    state.dragging = true;
    state.dragX = e.clientX;
    state.dragY = e.clientY;
    state.dragStartX = e.clientX;
    state.dragStartY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });

  on(canvas, 'pointermove', (e) => {
    if (!state.dragging || pinching) return;
    const s = worldScale(state.zoom, config.tileSize);
    state.worldCX -= (e.clientX - state.dragX) / s;
    state.worldCY -= (e.clientY - state.dragY) / s;
    state.dragX = e.clientX;
    state.dragY = e.clientY;
  });

  on(canvas, 'pointerup', (e) => {
    if (pinching) return;
    if (state.dragging) {
      const dx = e.clientX - state.dragStartX;
      const dy = e.clientY - state.dragStartY;
      if (Math.hypot(dx, dy) < TAP_THRESHOLD) {
        callbacks.onTap?.(e.clientX, e.clientY);
      } else {
        state.followBoatId = null;
      }
    }
    state.dragging = false;
  });

  on(canvas, 'pointercancel', () => { state.dragging = false; });

  // ─── Mouse wheel zoom ─────────────────────────────────────────
  on(canvas, 'wheel', (e) => {
    e.preventDefault();
    let d = e.deltaY;
    if (e.deltaMode === 1) d *= 40;
    const nz = Math.max(config.zoomMin, Math.min(config.zoomMax, state.zoom - d * 0.002));
    if (nz === state.zoom) return;
    zoomAt(state, config, e.clientX, e.clientY, nz);
  }, { passive: false });

  // ─── Touch (pinch zoom + two-finger pan) ──────────────────────
  on(canvas, 'touchstart', (e) => {
    if (e.touches.length === 2) {
      // Enter pinch mode — kill any active pointer drag
      pinching = true;
      state.dragging = false;
      state.followBoatId = null;

      const t = e.touches;
      pinchDist = Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
      pinchMidX = (t[0].clientX + t[1].clientX) / 2;
      pinchMidY = (t[0].clientY + t[1].clientY) / 2;
      pinchZoomStart = state.zoom;
    }
  }, { passive: true });

  on(canvas, 'touchmove', (e) => {
    if (!pinching || e.touches.length !== 2) return;

    const t = e.touches;
    const newDist = Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const mx = (t[0].clientX + t[1].clientX) / 2;
    const my = (t[0].clientY + t[1].clientY) / 2;

    // Zoom: compute from original pinch start (no accumulation drift)
    const rawZoom = pinchZoomStart + Math.log2(newDist / pinchDist);
    const nz = Math.max(config.zoomMin, Math.min(config.zoomMax, rawZoom));

    if (nz !== state.zoom) {
      zoomAt(state, config, mx, my, nz);
    }

    // Pan: move by midpoint delta
    const s = worldScale(state.zoom, config.tileSize);
    state.worldCX -= (mx - pinchMidX) / s;
    state.worldCY -= (my - pinchMidY) / s;
    pinchMidX = mx;
    pinchMidY = my;
  }, { passive: true });

  on(canvas, 'touchend', (e) => {
    if (e.touches.length < 2) {
      pinching = false;
    }
  });

  on(canvas, 'touchcancel', () => { pinching = false; });

  return () => cleanups.forEach((fn) => fn());
}

/** Apply zoom centered on a screen point */
function zoomAt(state: MapState, config: MapConfig, sx: number, sy: number, newZoom: number): void {
  const s0 = worldScale(state.zoom, config.tileSize);
  const wmx = state.worldCX + (sx - state.width / 2) / s0;
  const wmy = state.worldCY + (sy - state.height / 2) / s0;
  state.zoom = newZoom;
  const s1 = worldScale(state.zoom, config.tileSize);
  state.worldCX = wmx - (sx - state.width / 2) / s1;
  state.worldCY = wmy - (sy - state.height / 2) / s1;
}
