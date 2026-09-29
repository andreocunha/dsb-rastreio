import { parseLiveCourse, type LiveCourse } from './course-data';

/**
 * Courses live in the database and reach spectators over the live stream. The last
 * published course is cached on the device so the map still opens offline.
 */
const KEY = 'dsb:live-course:v1';
export function readCachedCourse(): LiveCourse | null {
  try { return parseLiveCourse(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch { return null; }
}
export function cacheCourse(course: LiveCourse) {
  try { localStorage.setItem(KEY, JSON.stringify(course)); return true; } catch { return false; }
}
