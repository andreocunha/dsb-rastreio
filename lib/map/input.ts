import type { MapState, MapConfig } from './types';
import { worldScale } from './geo';

type Cleanup = () => void;

export interface InputCallbacks {
  screenToWorld?: (x:number,y:number) => {x:number;y:number}|null;
  onTap?: (screenX: number, screenY: number) => void;
  onEditStart?: (screenX: number, screenY: number) => boolean;
  onEditMove?: (screenX: number, screenY: number) => void;
  onEditEnd?: (cancelled: boolean) => void;
  /** True when the view can rotate and tilt (3D). */
  canOrient?: () => boolean;
}

const TAP_THRESHOLD = 6;
export const PITCH_MIN = 45, PITCH_MAX = 88;
const clampPitch = (p: number) => Math.max(PITCH_MIN, Math.min(PITCH_MAX, p));
const wrap = (a: number) => ((a % 360) + 360) % 360;

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
  // Google Maps style: Ctrl/Shift + drag or right-drag rotates (horizontal) and tilts (vertical).
  let orienting = false;
  let startBearing = 0, startPitch = 74;
  let pinchAngle = 0, pinchMode: 'undecided' | 'zoom' | 'tilt' = 'undecided', pinchStartMidY = 0;
  const currentPitch = () => state.pitch ?? (state.followBoatId ? 63 : 74);
  function cancelEdit() {
    if (editingPoint) callbacks.onEditEnd?.(true);
    editingPoint = false;
    state.dragging = false;
  }

  // ─── Pointer (single finger drag / mouse) ─────────────────────
  on(canvas, 'contextmenu', (e) => { if (callbacks.canOrient?.()) e.preventDefault(); });
  on(canvas, 'pointerdown', (e) => {
    if (pinching || e.isPrimary === false) return;
    if (callbacks.canOrient?.() && e.pointerType === 'mouse' && (e.button === 2 || (e.button === 0 && (e.ctrlKey || e.shiftKey || e.metaKey)))) {
      orienting = true; startBearing = state.bearing; startPitch = currentPitch();
      state.dragStartX = e.clientX; state.dragStartY = e.clientY; state.dragging = true;
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
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
    if (orienting) {
      state.bearing = wrap(startBearing + (e.clientX - state.dragStartX) * 0.4);
      state.pitch = clampPitch(startPitch + (e.clientY - state.dragStartY) * 0.25);
      return;
    }
    if (!state.dragging || pinching || e.isPrimary === false) return;
    if (Math.hypot(e.clientX - state.dragStartX, e.clientY - state.dragStartY) > TAP_THRESHOLD) moved = true;
    if (moved) state.followBoatId = null;
    if (editingPoint) {
      if (moved) callbacks.onEditMove?.(e.clientX, e.clientY);
      return;
    }
    const s = worldScale(state.zoom, config.tileSize);
    const a=callbacks.screenToWorld?.(state.dragX,state.dragY),b=callbacks.screenToWorld?.(e.clientX,e.clientY);
    state.worldCX -= a&&b?b.x-a.x:(e.clientX-state.dragX)/s;
    state.worldCY -= a&&b?b.y-a.y:(e.clientY-state.dragY)/s;
    state.dragX = e.clientX;
    state.dragY = e.clientY;
  });

  on(canvas, 'pointerup', (e) => {
    if (orienting) { orienting = false; state.dragging = false; return; }
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

  on(canvas, 'pointercancel', () => { orienting = false; cancelEdit(); });

  // ─── Mouse wheel zoom ─────────────────────────────────────────
  on(canvas, 'wheel', (e) => {
    e.preventDefault();
    cancelEdit();
    let d = e.deltaY;
    if (e.deltaMode === 1) d *= 40;
    const nz = Math.max(config.zoomMin, Math.min(config.zoomMax, state.zoom - d * 0.002));
    if (nz === state.zoom) return;
    if(callbacks.screenToWorld?.(e.clientX,e.clientY))state.zoom=nz;
    else zoomAt(state, config, e.clientX, e.clientY, nz);
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
      pinchAngle = Math.atan2(t[1].clientY - t[0].clientY, t[1].clientX - t[0].clientX);
      pinchStartMidY = pinchMidY; pinchMode = 'undecided';
      startBearing = state.bearing; startPitch = currentPitch();
    }
  }, { passive: true });

  on(canvas, 'touchmove', (e) => {
    if (!pinching || e.touches.length !== 2) return;

    const t = e.touches;
    const newDist = Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const mx = (t[0].clientX + t[1].clientX) / 2;
    const my = (t[0].clientY + t[1].clientY) / 2;

    // Two fingers side by side sliding up/down tilt the 3D view (as in Google Maps);
    // otherwise the gesture pinches, pans and twists.
    const twist = Math.atan2(t[1].clientY - t[0].clientY, t[1].clientX - t[0].clientX) - pinchAngle;
    if (pinchMode === 'undecided' && callbacks.canOrient?.()) {
      const lift = my - pinchStartMidY, spread = Math.abs(newDist - pinchDist);
      const level = Math.abs(Math.sin(pinchAngle)) < 0.5;
      if (level && Math.abs(lift) > 14 && spread < 18) pinchMode = 'tilt';
      else if (spread > 12 || Math.abs(twist) > 0.1 || Math.hypot(mx - pinchMidX, my - pinchMidY) > 14) pinchMode = 'zoom';
    }
    if (pinchMode === 'tilt') {
      state.pitch = clampPitch(startPitch + (my - pinchStartMidY) * 0.3);
      return;
    }
    if (callbacks.canOrient?.()) {
      const turn = Math.atan2(Math.sin(twist), Math.cos(twist)) * 180 / Math.PI;
      // A small dead zone keeps plain pinches from rotating the map.
      if (Math.abs(turn) > 6) state.bearing = wrap(startBearing - (turn - Math.sign(turn) * 6));
    }
    // Zoom: compute from original pinch start (no accumulation drift)
    const rawZoom = pinchZoomStart + Math.log2(Math.max(1, newDist) / Math.max(1, pinchDist));
    const nz = Math.max(config.zoomMin, Math.min(config.zoomMax, rawZoom));

    if (nz !== state.zoom) {
      if(callbacks.screenToWorld?.(mx,my))state.zoom=nz;
      else zoomAt(state, config, mx, my, nz);
    }

    // Pan: move by midpoint delta
    const s = worldScale(state.zoom, config.tileSize);
    const a=callbacks.screenToWorld?.(pinchMidX,pinchMidY),b=callbacks.screenToWorld?.(mx,my);
    state.worldCX -= a&&b?b.x-a.x:(mx-pinchMidX)/s;
    state.worldCY -= a&&b?b.y-a.y:(my-pinchMidY)/s;
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
