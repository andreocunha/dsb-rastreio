import type { MapState, MapConfig } from './types';
import { worldScale } from './geo';

type Cleanup = () => void;

export interface InputCallbacks {
  onTap?: (screenX: number, screenY: number) => void;
  onEditStart?: (screenX: number, screenY: number) => boolean;
  onEditMove?: (screenX: number, screenY: number) => void;
  onEditEnd?: (cancelled: boolean) => void;
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
  let editingPoint = false;
  let moved = false;
  function cancelEdit() {
    if (editingPoint) callbacks.onEditEnd?.(true);
    editingPoint = false;
    state.dragging = false;
  }

  // ─── Pointer (single finger drag / mouse) ─────────────────────
  on(canvas, 'pointerdown', (e) => {
    if (pinching || e.button !== 0 || e.isPrimary === false) return;
    editingPoint = callbacks.onEditStart?.(e.clientX, e.clientY) ?? false;
    moved = false;
    state.dragging = true;
    state.dragX = e.clientX;
    state.dragY = e.clientY;
    state.dragStartX = e.clientX;
    state.dragStartY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });

  on(canvas, 'pointermove', (e) => {
    if (!state.dragging || pinching || e.isPrimary === false) return;
    if (Math.hypot(e.clientX - state.dragStartX, e.clientY - state.dragStartY) > TAP_THRESHOLD) moved = true;
    if (moved) state.followBoatId = null;
    if (editingPoint) {
      if (moved) callbacks.onEditMove?.(e.clientX, e.clientY);
      return;
    }
    const s = worldScale(state.zoom, config.tileSize);
    state.worldCX -= (e.clientX - state.dragX) / s;
    state.worldCY -= (e.clientY - state.dragY) / s;
    state.dragX = e.clientX;
    state.dragY = e.clientY;
  });

  on(canvas, 'pointerup', (e) => {
    if (pinching || e.isPrimary === false) return;
    if (state.dragging) {
      if (editingPoint) callbacks.onEditEnd?.(!moved);
      editingPoint = false;
      if (!moved) {
        callbacks.onTap?.(e.clientX, e.clientY);
      } else {
        state.followBoatId = null;
      }
    }
    state.dragging = false;
  });

  on(canvas, 'pointercancel', cancelEdit);

  // ─── Mouse wheel zoom ─────────────────────────────────────────
  on(canvas, 'wheel', (e) => {
    e.preventDefault();
    cancelEdit();
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
      cancelEdit();
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
    const rawZoom = pinchZoomStart + Math.log2(Math.max(1, newDist) / Math.max(1, pinchDist));
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
