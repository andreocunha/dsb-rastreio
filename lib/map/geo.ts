import type { WorldPoint, ScreenPoint } from './types';

/** Convert lat/lon to world coordinates (0..1 range) */
export function geoToWorld(lat: number, lon: number): WorldPoint {
  const r = (lat * Math.PI) / 180;
  return {
    x: (lon + 180) / 360,
    y: (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2,
  };
}

/** Get the world scale factor for a given zoom level and tile size */
export function worldScale(zoom: number, tileSize: number): number {
  return Math.pow(2, zoom) * tileSize;
}

/** Convert lat/lon to screen coordinates */
export function geoToScreen(
  lat: number,
  lon: number,
  worldCX: number,
  worldCY: number,
  zoom: number,
  tileSize: number,
  viewW: number,
  viewH: number,
): ScreenPoint {
  const w = geoToWorld(lat, lon);
  const s = worldScale(zoom, tileSize);
  return {
    x: (w.x - worldCX) * s + viewW / 2,
    y: (w.y - worldCY) * s + viewH / 2,
  };
}

/** Convert screen coordinates back to lat/lon */
export function screenToGeo(
  sx: number,
  sy: number,
  worldCX: number,
  worldCY: number,
  zoom: number,
  tileSize: number,
  viewW: number,
  viewH: number,
): { lat: number; lon: number } {
  const s = worldScale(zoom, tileSize);
  const wx = worldCX + (sx - viewW / 2) / s;
  const wy = worldCY + (sy - viewH / 2) / s;
  const lon = wx * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * wy))) * 180) / Math.PI;
  return { lat, lon };
}

/**
 * Pre-computed projection for a single frame.
 * Avoids recalculating scale/offset for every point (critical at 20+ boats).
 */
export interface FrameProjection {
  s: number;    // world scale
  ox: number;   // x offset (worldCX * s - viewW/2)
  oy: number;   // y offset (worldCY * s - viewH/2)
}

export function createFrameProjection(
  worldCX: number, worldCY: number,
  zoom: number, tileSize: number,
  viewW: number, viewH: number,
): FrameProjection {
  const s = worldScale(zoom, tileSize);
  return { s, ox: worldCX * s - viewW / 2, oy: worldCY * s - viewH / 2 };
}

/** Fast lat/lon to screen using pre-computed projection */
export function projectGeo(lat: number, lon: number, fp: FrameProjection): ScreenPoint {
  const r = (lat * Math.PI) / 180;
  const wx = (lon + 180) / 360;
  const wy = (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
  return { x: wx * fp.s - fp.ox, y: wy * fp.s - fp.oy };
}

/** Calculate bearing between two [lat, lon] points in degrees */
export function bearing(
  a: [number, number],
  b: [number, number],
): number {
  const dL = ((b[1] - a[1]) * Math.PI) / 180;
  const la = (a[0] * Math.PI) / 180;
  const lb = (b[0] * Math.PI) / 180;
  return (
    ((Math.atan2(
      Math.sin(dL) * Math.cos(lb),
      Math.cos(la) * Math.sin(lb) -
        Math.sin(la) * Math.cos(lb) * Math.cos(dL),
    ) *
      180) /
      Math.PI +
      360) %
    360
  );
}
