import type { GeoPoint, MapConfig, MapState } from './types';
import { geoToScreen } from './geo';

export function editHandles(state: MapState): {point: GeoPoint; routeId?: string}[] {
  switch (state.editTool) {
    case 'buoy': return state.buoys.map(point => ({point}));
    case 'route': return state.routes.flatMap(r => r.points.map(point => ({point, routeId: r.id})));
    case 'finish': return [state.finishLine.p1, state.finishLine.p2].filter((p): p is GeoPoint => !!p).map(point => ({point}));
    case 'maintenance': return state.maintenanceArea.map(point => ({point}));
    case 'waiting': return state.waitingArea.map(point => ({point}));
    default: return [];
  }
}
export function pickHandle(state: MapState, config: MapConfig, x: number, y: number) {
  let closest: ReturnType<typeof editHandles>[number] | null = null;
  let distance = 22;
  for (const handle of editHandles(state)) {
    const p = geoToScreen(handle.point.lat, handle.point.lon, state.worldCX, state.worldCY, state.zoom, config.tileSize, state.width, state.height);
    const d = Math.hypot(x - p.x, y - p.y);
    if (d < distance) { distance = d; closest = handle; }
  }
  return closest;
}
/** Insert between neighboring vertices when the user taps an existing path. */
export function insertRoutePoint(state: MapState, config: MapConfig, x: number, y: number, point: GeoPoint) {
  let closest: {route: MapState['routes'][number]; index: number} | null = null;
  let distance = 12;
  for (const route of state.routes) {
    if (route.points.length >= 2000) continue;
    const projected = route.points.map(p => geoToScreen(p.lat, p.lon, state.worldCX, state.worldCY, state.zoom, config.tileSize, state.width, state.height));
    for (let i = 1; i < projected.length; i++) {
      const a = projected[i - 1], b = projected[i];
      const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
      if (!length) continue;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / length));
      const d = Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
      if (d < distance) { distance = d; closest = {route, index: i}; }
    }
  }
  if (!closest) return false;
  closest.route.points.splice(closest.index, 0, point);
  state.activeRouteId = closest.route.id;
  return true;
}
