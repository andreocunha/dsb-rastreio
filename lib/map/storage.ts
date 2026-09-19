import type { MapState, GeoPoint } from './types';
import { COURSE_PRESETS, CUSTOM_COURSE_ID, defaultCourse, MAINTENANCE_AREA, WAITING_AREA, LEGACY_MAINTENANCE_AREA, LEGACY_SPRINT_POINTS } from './courses';
const KEY = 'dsb:course:v1';
const SELECTED_KEY = 'dsb:selected-course:v2';
const AREAS_KEY = 'dsb:event-areas:v1';
const courseKey = (id: string) => `dsb:course:v2:${id}`;
export const validCourseId = (id: string) => id === CUSTOM_COURSE_ID || COURSE_PRESETS.some(p => p.id === id);
const validPoint = (p: unknown): p is GeoPoint => {
  if (!p || typeof p !== 'object') return false;
  const v = p as GeoPoint;
  return Number.isFinite(v.lat) && Math.abs(v.lat) <= 85 && Number.isFinite(v.lon) && Math.abs(v.lon) <= 180;
};
const validArea = (area: unknown): area is GeoPoint[] => Array.isArray(area) && area.length <= 300 && area.every(validPoint);
function restoreEventAreas(state: MapState) {
  state.maintenanceArea = MAINTENANCE_AREA.map(p => ({...p}));
  state.waitingArea = WAITING_AREA.map(p => ({...p}));
  try {
    const areas = JSON.parse(localStorage.getItem(AREAS_KEY) || 'null');
    if (areas?.version === 1) {
      if (validArea(areas.maintenanceArea)) state.maintenanceArea = areas.maintenanceArea;
      if (validArea(areas.waitingArea)) state.waitingArea = areas.waitingArea;
    } else {
      // Preserve the organizer's already adjusted Match Race area as the event area.
      const previous = JSON.parse(localStorage.getItem(courseKey('match-race')) || 'null');
      if (previous?.version === 1 && validArea(previous.maintenanceArea) && previous.maintenanceArea.length >= 3 && JSON.stringify(previous.maintenanceArea) !== JSON.stringify(LEGACY_MAINTENANCE_AREA)) {
        state.maintenanceArea = previous.maintenanceArea;
      }
    }
  } catch { /* Shared built-in areas remain available without storage. */ }
}
export function restoreCourse(state: MapState, id?: string) {
  try {
    let key = KEY;
    if (state.courseId !== undefined) {
      const selected = id ?? localStorage.getItem(SELECTED_KEY);
      state.courseId = selected && validCourseId(selected) ? selected : localStorage.getItem(KEY) ? CUSTOM_COURSE_ID : COURSE_PRESETS[0].id;
      Object.assign(state, defaultCourse(state.courseId));
      key = courseKey(state.courseId);
      if (state.courseId === CUSTOM_COURSE_ID && !localStorage.getItem(key)) key = KEY;
    }
    const data = JSON.parse(localStorage.getItem(key) || 'null');
    if (!data || data.version !== 1) return;
    if (Array.isArray(data.buoys) && data.buoys.length <= 300 && data.buoys.every((b: {id: unknown; number: number}) => validPoint(b) && typeof b.id === 'string' && Number.isInteger(b.number))) state.buoys = data.buoys;
    if (Array.isArray(data.routes) && data.routes.length <= 50 && data.routes.every((r: {id: unknown; color: string; points: unknown[]}) => typeof r.id === 'string' && /^#[0-9a-f]{6}$/i.test(r.color) && Array.isArray(r.points) && r.points.length <= 2000 && r.points.every(validPoint))) state.routes = data.routes;
    if (Array.isArray(data.maintenanceArea) && data.maintenanceArea.length <= 300 && data.maintenanceArea.every(validPoint)) state.maintenanceArea = data.maintenanceArea;
    if (data.finishLine && [data.finishLine.p1, data.finishLine.p2].every(p => p === null || validPoint(p))) state.finishLine = data.finishLine;
    // Replace only the unchanged old straight Sprint template, preserving custom paths.
    if (state.courseId === 'sprint' && data.rulesRevision !== 2 && state.routes.length === 1 && JSON.stringify(state.routes[0].points) === JSON.stringify(LEGACY_SPRINT_POINTS)) {
      state.routes = defaultCourse('sprint').routes;
    }
  } catch {
    // Built-in courses also work when the storage API is blocked.
    if (state.courseId !== undefined && id && validCourseId(id)) {
      state.courseId = id;
      Object.assign(state, defaultCourse(id));
    }
  } finally {
    if (state.courseId !== undefined) restoreEventAreas(state);
  }
}
export function saveCourse(state: MapState) {
  try {
    if (state.courseId !== undefined) localStorage.setItem(AREAS_KEY, JSON.stringify({version: 1, maintenanceArea: state.maintenanceArea, waitingArea: state.waitingArea}));
    localStorage.setItem(state.courseId === undefined ? KEY : courseKey(state.courseId), JSON.stringify({version: 1, rulesRevision: 2, buoys: state.buoys, routes: state.routes, maintenanceArea: state.maintenanceArea, finishLine: state.finishLine}));
    if (state.courseId !== undefined) localStorage.setItem(SELECTED_KEY, state.courseId);
    return true;
  } catch { return false; }
}
