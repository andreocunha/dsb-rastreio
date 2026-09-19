import type { Buoy, FinishLine, GeoPoint, Route } from './types';

export interface Course {
  buoys: Buoy[];
  routes: Route[];
  finishLine: FinishLine;
  maintenanceArea: GeoPoint[];
  waitingArea: GeoPoint[];
}
export interface CoursePreset extends Course {
  id: string;
  name: string;
  schedule: string;
  reference: string;
}

// Manually traced from the supplied images, with their white title strips removed.
// Approximate placement only: the JPEGs contain no coordinates for the markers.
// Keep the original pixel geometry here so it can be replaced with surveyed GPS later.
type Pixel = [number, number];
function point([x, y]: Pixel, wide = false): GeoPoint {
  return wide
    ? {lon: -41.8189 + (x - 1165) * .000016, lat: -22.4144 - (y - 717) * .0000148 + (x - 1165) * .0000014}
    : {lon: -41.8189 + (x - 1086) * .0000048, lat: -22.4144 - (y - 448) * .0000042};
}
const gate: Pixel[] = [[1029, 436], [1143, 460]];
const support: Pixel[] = [[1116, 620], [892, 772], [901, 798], [1129, 642]];
// Shared event areas, aligned to the organizer's latest screenshot.
export const MAINTENANCE_AREA: GeoPoint[] = [
  {lat: -22.4153709, lon: -41.8182641}, {lat: -22.4157105, lon: -41.8177821},
  {lat: -22.416296, lon: -41.818007}, {lat: -22.4166552, lon: -41.8187783},
  {lat: -22.4161435, lon: -41.8192283},
];
export const WAITING_AREA: GeoPoint[] = [
  {lat: -22.41458, lon: -41.81813}, {lat: -22.41474, lon: -41.81765},
  {lat: -22.41527, lon: -41.8179}, {lat: -22.41511, lon: -41.81838},
];
export const LEGACY_MAINTENANCE_AREA = support.map(p => point(p));
export const LEGACY_SPRINT_POINTS = [[1160, 70], [1086, 428]].map(p => point(p as Pixel));
const maneuver: Pixel[] = [[1087, 483], [728, 814], [496, 55], [547, 26], [945, 378], [1237, 60], [1286, 66], [1098, 437]];
const maneuverBuoys: Pixel[] = [[741, 740], [542, 63], [948, 351], [1256, 78]];

function preset(id: string, name: string, schedule: string, reference: string, buoys: Pixel[], paths: Pixel[][], finish = gate, wide = false): CoursePreset {
  return {
    id, name, schedule, reference,
    buoys: buoys.map((p, i) => ({id: `buoy-${i + 1}`, number: i + 1, ...point(p, wide)})),
    routes: paths.map((points, i) => ({id: `route-${i + 1}`, color: i ? '#78db9c' : '#b8edf0', points: points.map(p => point(p, wide))})),
    finishLine: {p1: point(finish[0], wide), p2: point(finish[1], wide)},
    maintenanceArea: MAINTENANCE_AREA.map(p => ({...p})),
    waitingArea: WAITING_AREA.map(p => ({...p})),
  };
}

export const COURSE_PRESETS: CoursePreset[] = [
  preset('raia-rapida', '1 · Raia Rápida', '13 out · 15:00', '13.32.59 (1)',
    [[1001, 586], [200, 103], [1307, 52]],
    [[[1100, 473], [1015, 630], [141, 114], [190, 63], [1332, 34], [1112, 446]]]),
  preset('match-race', '2 · Match Race', '14 out · 10:00', '13.32.59 (2)',
    [[714, 301], [967, 368], [921, 449], [867, 529]],
    [[[1056, 485], [920, 425], [907, 450], [1030, 554], [1044, 541], [980, 342], [675, 276], [855, 562], [1105, 611]],
      [[1085, 441], [985, 330], [653, 259], [847, 574], [1044, 568], [1064, 538], [920, 403], [883, 451], [1115, 600]]],
    [[1030, 534], [1134, 456]]),
  preset('raia-manobra', '3 · Raia de Manobra', '14 out · 14:00', '13.33.00', maneuverBuoys, [maneuver]),
  preset('raia-longa', '4 · Raia Longa', '15 out · 08:00', '13.33.00 (1)',
    [[1133, 758], [225, 243], [1144, 227], [1389, 411]],
    [[[1167, 732], [1143, 778], [206, 257], [200, 228], [1153, 210], [1408, 412], [1184, 642], [1167, 700]]],
    [[1142, 713], [1188, 722]], true),
  preset('revezamento', '5 · Revezamento de Pilotos', '16 out · 09:00', '13.33.00 (2)', maneuverBuoys, [maneuver]),
  preset('sprint', '6 · Sprint', '17 out · 09:00', '13.32.59',
    [[1059, 39], [1242, 64]],
    [[[1100, 460], [1290, 120], [1298, 58], [1270, 12], [1205, 3], [1151, 30], [1151, 51.5], [1100, 425]]]),
  preset('slalom', '7 · Slalom', '17 out · 09:30', '13.33.00 (3)',
    [[921, 412], [1006, 474], [987, 509], [970, 545], [955, 581], [937, 618]],
    [[[1086, 432], [991, 464], [998, 490], [973, 501], [980, 527], [955, 536], [963, 563], [939, 574], [946, 600], [926, 608], [926, 629], [951, 631], [936, 602], [970, 588], [963, 560], [982, 554], [975, 527], [1001, 518], [994, 490], [1021, 481], [1014, 433], [1047, 405]]]),
];

export const CUSTOM_COURSE_ID = 'custom';
export function copyCourse(course: Course): Course {
  return JSON.parse(JSON.stringify({buoys: course.buoys, routes: course.routes, finishLine: course.finishLine, maintenanceArea: course.maintenanceArea, waitingArea: course.waitingArea}));
}
export function defaultCourse(id: string): Course {
  return copyCourse(COURSE_PRESETS.find(p => p.id === id) ?? {buoys: [], routes: [], finishLine: {p1: null, p2: null}, maintenanceArea: MAINTENANCE_AREA, waitingArea: WAITING_AREA});
}
