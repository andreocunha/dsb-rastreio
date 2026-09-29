import type { Buoy, FinishLine, GeoPoint, Route } from './types';

/** Geometry of one course, as stored in tracker_courses and sent to spectators. */
export interface CourseGeometry { buoys: Buoy[]; routes: Route[]; finishLine: FinishLine }
export interface EventAreas { maintenanceArea: GeoPoint[]; waitingArea: GeoPoint[] }
/** What spectators see now: pushed by the live server whenever the organization changes it. */
export interface LiveCourse {
  venue: string;
  course: string;
  /** Null: the built-in model of that course. */
  geometry: CourseGeometry | null;
  /** Null: the built-in event areas. */
  areas: EventAreas | null;
  updatedAt: string;
}

const point = (p: unknown): GeoPoint | null => {
  if (!p || typeof p !== 'object') return null;
  const {lat, lon} = p as GeoPoint;
  return Number.isFinite(lat) && Math.abs(lat) <= 85 && Number.isFinite(lon) && Math.abs(lon) <= 180 ? {lat, lon} : null;
};
const points = (value: unknown, max: number) => {
  if (!Array.isArray(value) || value.length > max) return null;
  const out = value.map(point);
  return out.every(Boolean) ? out as GeoPoint[] : null;
};

/** Strict sanitising: unknown keys are dropped, anything malformed rejects the whole course. */
export function parseGeometry(value: unknown): CourseGeometry | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (!Array.isArray(data.buoys) || data.buoys.length > 300 || !Array.isArray(data.routes) || data.routes.length > 50) return null;
  const buoys: Buoy[] = [];
  for (const b of data.buoys as Record<string, unknown>[]) {
    const p = point(b);
    if (!p || typeof b.id !== 'string' || b.id.length > 60 || !Number.isInteger(b.number) || (b.number as number) < 0 || (b.number as number) > 999) return null;
    buoys.push({id: b.id, number: b.number as number, ...p});
  }
  const routes: Route[] = [];
  for (const r of data.routes as Record<string, unknown>[]) {
    const ps = points(r?.points, 2000);
    if (!ps || typeof r.id !== 'string' || r.id.length > 60 || typeof r.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(r.color)) return null;
    routes.push({id: r.id, color: r.color, points: ps});
  }
  const finish = data.finishLine as Record<string, unknown> | undefined;
  const p1 = finish?.p1 == null ? null : point(finish.p1), p2 = finish?.p2 == null ? null : point(finish.p2);
  if ((finish?.p1 != null && !p1) || (finish?.p2 != null && !p2)) return null;
  return {buoys, routes, finishLine: {p1, p2}};
}
export function parseAreas(value: unknown): EventAreas | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  const maintenanceArea = points(data.maintenanceArea, 300), waitingArea = points(data.waitingArea, 300);
  return maintenanceArea && waitingArea ? {maintenanceArea, waitingArea} : null;
}
const SLUG = /^[a-z0-9-]{1,40}$/;
export const validSlug = (value: unknown): value is string => typeof value === 'string' && SLUG.test(value);
export function parseLiveCourse(value: unknown): LiveCourse | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (!validSlug(data.venue) || !validSlug(data.course)) return null;
  const geometry = data.geometry == null ? null : parseGeometry(data.geometry);
  const areas = data.areas == null ? null : parseAreas(data.areas);
  if ((data.geometry != null && !geometry) || (data.areas != null && !areas)) return null;
  return {venue: data.venue, course: data.course, geometry, areas, updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : ''};
}
/** Row ids in tracker_courses. */
export const courseRowId = (venue: string, course: string) => `${venue}:${course}`;
export const areasRowId = (venue: string) => `${venue}:areas`;
export const ACTIVE_ROW = 'active';
