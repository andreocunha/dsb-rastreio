import type { MapState, MapConfig } from './types';
import { worldScale } from './geo';

type Cleanup = () => void;

export interface InputCallbacks {
  onTap?: (screenX: number, screenY: number) => void;
}

const TAP_THRESHOLD = 6;

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

/** Attach all pointer/wheel/touch handlers to the canvas. Returns a cleanup function. */
export function attachInputHandlers(
  canvas: HTMLCanvasElement,
  state: MapState,
  config: MapConfig,
  callbacks: InputCallbacks = {},
): Cleanup {
  const cleanups: Cleanup[] = [];

  function on<K extends keyof HTMLElementEventMap>(
    el: HTMLCanvasElement,
    evt: K,
    fn: (e: HTMLElementEventMap[K]) => void,
    opts?: AddEventListenerOptions,
  ) {
    el.addEventListener(evt, fn, opts);
    cleanups.push(() => el.removeEventListener(evt, fn, opts));
  }

  // --- Pointer drag ---
  on(canvas, 'pointerdown', (e) => {
    state.dragging = true;
    state.dragX = e.clientX;
    state.dragY = e.clientY;
    state.dragStartX = e.clientX;
    state.dragStartY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });

  on(canvas, 'pointermove', (e) => {
    if (!state.dragging) return;
    const s = worldScale(state.zoom, config.tileSize);
    state.worldCX -= (e.clientX - state.dragX) / s;
    state.worldCY -= (e.clientY - state.dragY) / s;
    state.dragX = e.clientX;
    state.dragY = e.clientY;
  });

  on(canvas, 'pointerup', (e) => {
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

  // --- Mouse wheel zoom ---
  on(canvas, 'wheel', (e) => {
    e.preventDefault();
    let d = e.deltaY;
    if (e.deltaMode === 1) d *= 40;
    const nz = Math.max(config.zoomMin, Math.min(config.zoomMax, state.zoom - d * 0.002));
    if (nz === state.zoom) return;
    zoomAt(state, config, e.clientX, e.clientY, nz);
  }, { passive: false });

  // --- Pinch zoom ---
  on(canvas, 'touchstart', (e) => {
    if (e.touches.length === 2) {
      const t = e.touches;
      state.lastPinchDist = Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
      state.pinchMidX = (t[0].clientX + t[1].clientX) / 2;
      state.pinchMidY = (t[0].clientY + t[1].clientY) / 2;
      state.followBoatId = null;
    }
  }, { passive: true });

  on(canvas, 'touchmove', (e) => {
    if (e.touches.length !== 2 || state.lastPinchDist <= 0) return;
    const t = e.touches;
    const d = Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const nz = Math.max(config.zoomMin, Math.min(config.zoomMax, state.zoom + Math.log2(d / state.lastPinchDist)));

    const mx = (t[0].clientX + t[1].clientX) / 2;
    const my = (t[0].clientY + t[1].clientY) / 2;
    zoomAt(state, config, mx, my, nz);
    // Pan by pinch midpoint movement
    const s1 = worldScale(state.zoom, config.tileSize);
    state.worldCX -= (mx - state.pinchMidX) / s1;
    state.worldCY -= (my - state.pinchMidY) / s1;

    state.lastPinchDist = d;
    state.pinchMidX = mx;
    state.pinchMidY = my;
  }, { passive: true });

  on(canvas, 'touchend', () => { state.lastPinchDist = 0; });

  return () => cleanups.forEach((fn) => fn());
}
