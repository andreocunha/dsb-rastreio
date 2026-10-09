import type { RaceScene } from './three/scene';
import type { LightMode } from './three/lighting';
import { LiveMotion } from './live-motion';
import { isRecentPosition } from '../tracker/freshness';
import type { MapState, MapConfig, Buoy, Boat, EditTool, BoatType } from './types';
import { geoToWorld, geoToScreen, screenToGeo, bearing } from './geo';
import { TileCache } from './tiles';
import { renderFrame, renderBackground } from './renderer';
import { LabelLayout, drawLabels } from './labels';
import { refreshPeriod } from './pacing';
import { attachInputHandlers } from './input';
import { DEFAULT_CONFIG, ROUTE_COLORS } from './types';
import { readCachedCourse, cacheCourse } from './storage';
import type { CourseGeometry, EventAreas, LiveCourse } from './course-data';
import { COURSE_PRESETS, copyCourse, defaultCourse, MAINTENANCE_AREA, WAITING_AREA, type Course } from './courses';
import { pickHandle, insertRoutePoint, type Projector } from './editing';
import { venueById, emptyCourse } from './venues';
import { createSimulation } from './simulation';
import { logoUrl } from './logos';

// Demo route (circular path)
export const DEMO_ROUTE: [number, number][] = [
  [-22.414654, -41.818751], [-22.414, -41.8172], [-22.4132, -41.8158],
  [-22.4122, -41.8148], [-22.411, -41.8144], [-22.4098, -41.8148],
  [-22.4088, -41.8158], [-22.4082, -41.8172], [-22.408, -41.819],
  [-22.4084, -41.8208], [-22.4094, -41.8222], [-22.4106, -41.823],
  [-22.412, -41.8226], [-22.4132, -41.8216], [-22.4142, -41.82],
];

export const BOAT_DEFS: { id: string; label: string; type: BoatType; motors?: number; logo?: string; hull: string; accent: string; baseSpeed: number; startOffset: number }[] = [
  // Competidores: as many as at the event (10 racing + 3 support), so the demo is a fair load test.
  { id: 'b1', label: 'Solares', logo: 'solares.webp', type: 'cat', motors: 2, hull: '#ffffff', accent: '#2f86ff', baseSpeed: 8.5, startOffset: 0 },
  { id: 'b2', label: 'Arariboia', logo: 'arariboia.webp', type: 'mono', motors: 1, hull: '#ffe066', accent: '#ffc629', baseSpeed: 7.8, startOffset: 0.06 },
  { id: 'b3', label: 'Babitonga', logo: 'babitonga.webp', type: 'cat', motors: 3, hull: '#ff6666', accent: '#ff4d4f', baseSpeed: 9.0, startOffset: 0.12 },
  { id: 'b4', label: 'Abissol', logo: 'abissol.webp', type: 'mono', motors: 2, hull: '#66ff99', accent: '#7bd63a', baseSpeed: 7.2, startOffset: 0.18 },
  { id: 'b5', label: 'Hefesto', logo: 'hefesto.webp', type: 'cat', motors: 1,  hull: '#cc99ff', accent: '#a371ff', baseSpeed: 8.0, startOffset: 0.24 },
  { id: 'b6', label: 'Albardão', logo: 'albardao.webp', type: 'mono', motors: 3, hull: '#ffffff', accent: '#ff7a1f',    baseSpeed: 8.2, startOffset: 0.30 },
  { id: 'b7', label: 'Hurakan', logo: 'hurakan.webp', type: 'cat', motors: 2, hull: '#ffffff', accent: '#41d6f5', baseSpeed: 7.6, startOffset: 0.36 },
  { id: 'b8', label: 'Leviatã', logo: 'leviata.webp', type: 'mono', motors: 1, hull: '#ffffff', accent: '#ff5fa2', baseSpeed: 8.7, startOffset: 0.42 },
  { id: 'b9', label: 'Reis do Sol', logo: 'reis-do-sol.webp', type: 'cat', motors: 1, hull: '#ffffff', accent: '#2fd1a7', baseSpeed: 7.4, startOffset: 0.48 },
  { id: 'b10', label: 'Zênite Solar', logo: 'zenite.webp', type: 'mono', motors: 2, hull: '#ffffff', accent: '#c6e83a', baseSpeed: 8.4, startOffset: 0.54 },
  // Suporte
  { id: 's1', label: 'Jet Ski Resgate', type: 'jetski',  hull: '#f4f6f7', accent: '#aab4bc', baseSpeed: 12.0, startOffset: 0.40 },
  { id: 's2', label: 'Barco Suporte',   type: 'support', hull: '#f0f0f0', accent: '#aab4bc', baseSpeed: 10.0, startOffset: 0.55 },
  { id: 's3', label: 'Jet Ski Resgate 2', type: 'jetski', hull: '#f4f6f7', accent: '#aab4bc', baseSpeed: 11.5, startOffset: 0.70 },
];

const BUOY_HIT_RADIUS = 20;
const BOAT_HIT_RADIUS = 22;

export interface EngineCallbacks {
  on3DFallback?: () => void;
  onCourseChange?: (id: string, canUndo: boolean) => void;
  onSelectionChange?: (boatId: string | null) => void;
  onFleetUpdate?: (boats: Boat[]) => void;
  /** Organization edits, to be saved to the server (only while an edit session is open). */
  onCourseEdit?: (edit: {venue: string; course: string; geometry: CourseGeometry; areas: EventAreas}) => void;
  onTelemetryUpdate?: (boatId: string, lat: number, lon: number, speed: number, heading: number) => void;
  onBuoysChange?: (buoys: Buoy[]) => void;
  /** 3D camera heading/tilt each frame (null in the flat view), e.g. for a compass. */
  onView?: (heading: number | null, tilted: boolean) => void;
}

export interface LiveBoat { id: string; label: string; color: string; hull?: 'cat' | 'mono'; motors?: number; logo?: string; lat: number; lon: number; speed: number | null; heading: number | null; capturedAt: string; }
export interface EngineAPI {
  set3D: (canvas:HTMLCanvasElement|null) => Promise<boolean>;
  setLighting: (mode:LightMode) => void;
  setPhotographic: (enabled:boolean) => void;
  setDemoSpeed: (speed:number) => void;
  resetView: () => void;
  selectVenue: (id: string) => void;
  setLiveBoats: (boats: LiveBoat[]) => void;
  /** Course published by the organization: shown unless an edit session is open. */
  applyLiveCourse: (course: LiveCourse) => void;
  /** Organization editing: load any stored course without affecting what spectators see. */
  beginEdit: () => void;
  endEdit: () => void;
  loadCourse: (venue: string, course: string, geometry: CourseGeometry | null, areas: EventAreas | null) => void;
  resetCourse: () => void;
  undoCourse: () => void;
  fit: (padding?: Partial<Record<'left' | 'right' | 'top' | 'bottom', number>>) => void;
  zoom: (delta: number) => void;
  follow: (id: string | null) => void;
  setStyle: (style: MapState['style']) => void;
  setPaused: (paused: boolean) => void;
  /** The user is scrolling page UI (the fleet strip): render the map less often so the GPU stays free. */
  setUiBusy: (busy: boolean) => void;
  addBuoy: (lat: number, lon: number) => Buoy;
  removeBuoy: (id: string) => void;
  getBuoys: () => Buoy[];
  setEditTool: (tool: EditTool) => void;
  clearFinishLine: () => void;
  clearMaintenanceArea: () => void;
  clearWaitingArea: () => void;
  newRoute: (color: string) => void;
  undoRoutePoint: () => void;
  deleteRoute: (id: string) => void;
  /** Removes the selected route (the last one touched); undoable with undoCourse. */
  deleteActiveRoute: () => void;
  clearAllRoutes: () => void;
  destroy: () => void;
}

function createBoats(): Boat[] {
  return BOAT_DEFS.map((def, i) => {
    // Stagger start positions along the route
    const startT = def.startOffset;
    const startIdx = Math.floor(startT * DEMO_ROUTE.length) % DEMO_ROUTE.length;
    const localT = (startT * DEMO_ROUTE.length) % 1;
    const from = DEMO_ROUTE[startIdx];
    const to = DEMO_ROUTE[(startIdx + 1) % DEMO_ROUTE.length];

    return {
      activity: def.id.startsWith('s') ? 'support' : 'racing',
      raceRouteId: null,
      id: def.id,
      label: def.label,
      type: def.type,
      motors: def.motors,
      logo: logoUrl(def.logo),
      hullColor: def.hull,
      accentColor: def.accent,
      lat: from[0] + (to[0] - from[0]) * localT,
      lon: from[1] + (to[1] - from[1]) * localT,
      heading: bearing(from, to),
      headingTarget: bearing(from, to),
      speed: def.baseSpeed,
      baseSpeed: def.baseSpeed,
      speedPhaseOffset: i * 1.3,
      routeIndex: startIdx,
      routeT: localT,
      trail: [],
    };
  });
}

export function createMapState(config: MapConfig = DEFAULT_CONFIG): MapState {
  const start = geoToWorld(config.startLat, config.startLon);
  return {
    style: 'chart', paused: false, reducedMotion: false, animationTime: 0,
    width: 0,
    height: 0,
    dpr: 1,
    zoom: 17,
    worldCX: start.x,
    worldCY: start.y,
    bearing: 0,
    pitch: null,
    dragging: false,
    dragX: 0,
    dragY: 0,
    dragStartX: 0,
    dragStartY: 0,
    followBoatId: null,
    activeZi: 17,
    boats: createBoats(),
    courseId: COURSE_PRESETS[0].id,
    ...defaultCourse(COURSE_PRESETS[0].id),
    activeRouteId: null,
    editTool: null,
  };
}

/** Initialize the map engine on a canvas element. Returns an API object. */
export function initEngine(
  canvas: HTMLCanvasElement,
  background: HTMLCanvasElement,
  config: MapConfig = DEFAULT_CONFIG,
  callbacks: EngineCallbacks = {},
  live = false,
  presentationDemo = false,
): EngineAPI {
  const ctx = canvas.getContext('2d')!;
  const backgroundCtx = background.getContext('2d', { alpha: false })!;
  const state = createMapState(config);
  state.demo=!live;
  state.venueId = 'imboassica';
  // The course on screen is the one published by the organization (cached for offline).
  let liveCourse: LiveCourse = {venue: 'imboassica', course: COURSE_PRESETS[0].id, geometry: null, areas: null, updatedAt: ''};
  let editingSession = false;
  function resolveCourse(c: LiveCourse): Course {
    const base = c.venue === 'imboassica' ? defaultCourse(c.course) : {...emptyCourse(), waitingArea: []};
    const geometry = c.geometry ?? {buoys: base.buoys, routes: base.routes, finishLine: base.finishLine};
    const areas = c.areas ?? (c.venue === 'imboassica'
      ? {maintenanceArea: MAINTENANCE_AREA.map(p => ({...p})), waitingArea: WAITING_AREA.map(p => ({...p}))}
      : {maintenanceArea: [], waitingArea: []});
    return copyCourse({...geometry, ...areas});
  }
  if (!presentationDemo) liveCourse = readCachedCourse() ?? liveCourse;
  Object.assign(state, resolveCourse(liveCourse));
  state.venueId = liveCourse.venue; state.courseId = liveCourse.course;
  if (live) state.boats = [];
  const liveMotion = new Map<string,LiveMotion>();
  let view3D:RaceScene|null=null;
  let viewGeneration=0;
  let lighting:LightMode='live';
  let photographic=true,demoSpeed=1;
  let tickSimulation = createSimulation(state);
  let simulatedCourseId = state.courseId;
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  state.reducedMotion = motion.matches;
  const updateMotion = () => { state.reducedMotion = motion.matches; };
  motion.addEventListener('change', updateMotion);
  let sceneRevision = 0;
  let previousCourse = copyCourse(state);
  const history: Course[] = [];
  function notifyCourse() { callbacks.onCourseChange?.(state.courseId, history.length > 0); }
  function persist(record = true) {
    sceneRevision++;
    const nextCourse = copyCourse(state);
    const changed = JSON.stringify(previousCourse) !== JSON.stringify(nextCourse);
    if (record && changed) {
      history.push(previousCourse);
      if (history.length > 30) history.shift();
    }
    previousCourse = nextCourse;
    if (!live && (changed || simulatedCourseId !== state.courseId)) {
      tickSimulation = createSimulation(state);
      simulatedCourseId = state.courseId;
      callbacks.onFleetUpdate?.(state.boats.map(b => ({...b, trail: []})));
    }
    if (!presentationDemo && editingSession && changed) callbacks.onCourseEdit?.({
      venue: state.venueId ?? 'imboassica', course: state.courseId,
      geometry: {buoys: state.buoys, routes: state.routes, finishLine: state.finishLine},
      areas: {maintenanceArea: state.maintenanceArea, waitingArea: state.waitingArea},
    });
    notifyCourse();
  }
  notifyCourse();

  let buoyIdCounter = Math.max(0, ...state.buoys.map(b => Number(b.id.split('-').pop()) || 0));
  let routeIdCounter = Math.max(0, ...state.routes.map(r => Number(r.id.split('-').pop()) || 0));
  const tiles = new TileCache(config);

  let rafId = 0;
  let wakeTimer: ReturnType<typeof setTimeout> | undefined;
  let running = true;
  let uiBusy = false;
  // Eco mode (3D): full frame rate only while someone interacts or the camera is moving.
  // A race is watched for hours with the phone in hand; idle frames at 30 fps look the same
  // (boats cover a pixel or two per frame) and halve the heat and battery drain.
  const ECO_FPS = 30, ACTIVE_MS = 2500;
  let activeUntil = 0;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  /** Back to full rate immediately, cancelling a pending eco wait. */
  function wake() {
    activeUntil = now() + ACTIVE_MS;
    if (wakeTimer !== undefined && running && !document.hidden) { clearTimeout(wakeTimer); wakeTimer = undefined; rafId = requestAnimationFrame(frame); }
  }
  // Display refresh period, learnt from back-to-back animation frames (60, 90, 120 Hz… phones).
  // Display refresh period, learnt from back-to-back animation frames (60, 90, 120 Hz… phones).
  let vsync = 1000 / 60, lastCallback = 0, backToBack = false;
  const refreshes: number[] = [];
  function measureVsync(time: number) {
    const d = time - lastCallback;
    if (backToBack && lastCallback && d > 4 && d < 40) {
      refreshes.push(d); if (refreshes.length > 40) refreshes.shift();
      vsync = refreshPeriod(refreshes, vsync);
    }
    lastCallback = time; backToBack = true;
  }
  /** Frame interval for a wanted rate as a whole number of refreshes: even cadence, no 45 fps on 90 Hz when 60 is asked. */
  const paced = (wanted: number) => Math.max(1, Math.floor(1000 / wanted / vsync + .25)) * vsync;
  /**
   * Next frame in `wait` ms. Don't wake the page on every refresh just to skip it: sleep until just
   * after the refresh before the due one, then ask for an animation frame (it lands on the due one).
   */
  function schedule(wait: number) {
    if (wait > vsync + 4) { backToBack = false; wakeTimer = setTimeout(() => { wakeTimer = undefined; if (running) rafId = requestAnimationFrame(frame); }, wait - vsync + 3); }
    else rafId = requestAnimationFrame(frame);
  }

  const recycledNumbers: number[] = [];
  let nextBuoyNumber = Math.max(0, ...state.buoys.map(b => b.number)) + 1;

  function notifyBuoys() {
    persist();
    callbacks.onBuoysChange?.([...state.buoys]);
  }

  // --- Buoy helpers ---
  function addBuoy(lat: number, lon: number): Buoy {
    let num: number;
    if (recycledNumbers.length > 0) {
      recycledNumbers.sort((a, b) => a - b);
      num = recycledNumbers.shift()!;
    } else {
      num = nextBuoyNumber++;
    }
    const buoy: Buoy = {
      id: `buoy-${++buoyIdCounter}`,
      number: num,
      lat,
      lon,
    };
    const insertIdx = state.buoys.findIndex((b) => b.number > num);
    if (insertIdx === -1) {
      state.buoys.push(buoy);
    } else {
      state.buoys.splice(insertIdx, 0, buoy);
    }
    notifyBuoys();
    return buoy;
  }

  function removeBuoy(id: string) {
    const idx = state.buoys.findIndex((b) => b.id === id);
    if (idx !== -1) {
      recycledNumbers.push(state.buoys[idx].number);
      state.buoys.splice(idx, 1);
      notifyBuoys();
    }
  }

  function renumberBuoys() {
    for (let i = 0; i < state.buoys.length; i++) {
      state.buoys[i].number = i + 1;
    }
    recycledNumbers.length = 0;
    nextBuoyNumber = state.buoys.length + 1;
  }

  /** Replace the course on screen; refit the camera only when it is a different course. */
  function showCourse(c: LiveCourse, refit: boolean) {
    const venueChanged = state.venueId !== c.venue;
    state.venueId = c.venue; state.courseId = c.course;
    Object.assign(state, resolveCourse(c));
    state.editTool = editingSession ? state.editTool : null; selectFirstRoute();
    buoyIdCounter = Math.max(0, ...state.buoys.map(b => Number(b.id.split('-').pop()) || 0));
    routeIdCounter = Math.max(0, ...state.routes.map(r => Number(r.id.split('-').pop()) || 0));
    renumberBuoys();
    history.length = 0; previousCourse = copyCourse(state);
    if (refit || venueChanged) { state.boats.forEach(b => { b.trail = []; }); fit(); }
    if (!live) { tickSimulation = createSimulation(state); simulatedCourseId = state.courseId; }
    sceneRevision++; notifyCourse();
  }

  function hitTestBuoy(screenX: number, screenY: number): Buoy | null {
    for (let i = state.buoys.length - 1; i >= 0; i--) {
      const b = state.buoys[i];
      const p = toScreen(b);
      const dx = p.x - screenX;
      const dy = p.y - screenY;
      if (dx * dx + dy * dy <= BUOY_HIT_RADIUS * BUOY_HIT_RADIUS) return b;
    }
    return null;
  }

  function hitTestBoat(screenX: number, screenY: number): Boat | null {
    // Close up the hull is bigger than the fixed radius: tapping its bow must not count as open water.
    const radius = Math.max(BOAT_HIT_RADIUS, (view3D?.boatPixels() ?? 0) * .55);
    for (let i = state.boats.length - 1; i >= 0; i--) {
      const boat = state.boats[i];
      const p = view3D?.project(boat.lat,boat.lon,state,0,boat.id) ?? geoToScreen(
        boat.lat, boat.lon, state.worldCX, state.worldCY,
        state.zoom, config.tileSize, state.width, state.height,
      );
      const dx = p.x - screenX;
      const dy = p.y - screenY;
      if (dx * dx + dy * dy <= radius * radius) return boat;
    }
    return null;
  }

  // --- Route helpers ---
  function ensureActiveRoute(color: string) {
    if (!state.activeRouteId) {
      const route = { id: `route-${++routeIdCounter}`, color, points: [] as { lat: number; lon: number }[] };
      state.routes.push(route);
      state.activeRouteId = route.id;
    }
  }

  function getActiveRoute() {
    return state.routes.find((r) => r.id === state.activeRouteId) ?? null;
  }
  /** With the route tool on, one route is always selected so its buttons have a target. */
  function selectFirstRoute() {
    state.activeRouteId = state.editTool === 'route' ? state.routes[0]?.id ?? null : null;
  }

  const BACKGROUND_MARGIN = 80;
  const MAX_FOREGROUND_PIXELS = 5_000_000;
  let viewportRevision = 0;
  // --- Resize ---
  function resize() {
    viewportRevision++;
    state.width = window.innerWidth;
    state.height = window.innerHeight;
    const screenDpr = devicePixelRatio || 1;
    // Fine boat details need native phone density; bound the full-screen buffer on larger displays.
    state.dpr = Math.min(screenDpr, 3, Math.sqrt(MAX_FOREGROUND_PIXELS / Math.max(1, state.width * state.height)));
    const backgroundDpr = Math.min(screenDpr, 1.5);
    canvas.width = Math.floor(state.width * state.dpr);
    canvas.height = Math.floor(state.height * state.dpr);
    background.width = Math.floor((state.width + BACKGROUND_MARGIN * 2) * backgroundDpr);
    background.height = Math.floor((state.height + BACKGROUND_MARGIN * 2) * backgroundDpr);
    background.style.width = `${state.width + BACKGROUND_MARGIN * 2}px`;
    background.style.height = `${state.height + BACKGROUND_MARGIN * 2}px`;
    background.style.left = `${-BACKGROUND_MARGIN}px`;
    background.style.top = `${-BACKGROUND_MARGIN}px`;
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    backgroundCtx.setTransform(backgroundDpr, 0, 0, backgroundDpr, 0, 0);
  }

  function fit(padding: Partial<Record<'left' | 'right' | 'top' | 'bottom', number>> = {}) {
    state.followBoatId = null;
    const mobile = state.width < 700;
    const left = padding.left ?? (mobile ? 24 : 310), right = padding.right ?? (mobile ? 66 : 90);
    const top = padding.top ?? (mobile ? 90 : 70), bottom = padding.bottom ?? (mobile ? 180 : 90);
    const points = [...state.buoys, ...state.routes.flatMap(r => r.points), ...state.maintenanceArea, ...state.waitingArea, ...[state.finishLine.p1, state.finishLine.p2].filter(p => p !== null)];
    const venue = venueById(state.venueId);
    const nw = points.length ? geoToWorld(Math.max(...points.map(p => p.lat)) + .00025, Math.min(...points.map(p => p.lon)) - .00025) : geoToWorld(venue.lat + .003, venue.lon - .003);
    const se = points.length ? geoToWorld(Math.min(...points.map(p => p.lat)) - .00025, Math.max(...points.map(p => p.lon)) + .00025) : geoToWorld(venue.lat - .003, venue.lon + .003);
    const width = Math.max(170, state.width - left - right);
    const height = Math.max(180, state.height - top - bottom);
    state.zoom = Math.max(config.zoomMin, Math.min(config.zoomMax,
      Math.log2(Math.min(width / (se.x - nw.x), height / (se.y - nw.y)) / config.tileSize)));
    const scale = 2 ** state.zoom * config.tileSize;
    state.worldCX = (nw.x + se.x) / 2 - (left - right) / 2 / scale;
    state.worldCY = (nw.y + se.y) / 2 - (top - bottom) / 2 / scale;
  }
  resize();
  fit();
  window.addEventListener('resize', resize);

  let currentRouteColor = ROUTE_COLORS[0].hex;
  let draggedHandle: ReturnType<typeof pickHandle> = null;
  let dragOriginal: {lat: number; lon: number} | null = null;

  // Screen <-> geographic coordinates in whichever view is active (flat chart or 3D camera).
  const toScreen: Projector = p => view3D?.project(p.lat, p.lon, state) ?? geoToScreen(p.lat, p.lon, state.worldCX, state.worldCY, state.zoom, config.tileSize, state.width, state.height);
  function toGeo(x: number, y: number) {
    if (!view3D) return screenToGeo(x, y, state.worldCX, state.worldCY, state.zoom, config.tileSize, state.width, state.height);
    const w = view3D.screenWorld(x, y, state);
    return w ? {lon: w.x * 360 - 180, lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * w.y))) * 180 / Math.PI} : null;
  }

  // --- Input ---
  // Any touch, drag, pinch or wheel on the map: full frame rate right away.
  for (const evt of ['pointerdown', 'pointermove', 'wheel', 'touchstart'] as const) canvas.addEventListener?.(evt, wake, {passive: true});
  const detachInput = attachInputHandlers(canvas, state, config, {
    screenToWorld(x,y){return view3D?.screenWorld(x,y,state)??null;},
    canOrient(){return !!view3D;},
    onEditStart(x, y) {
      draggedHandle = pickHandle(state, toScreen, x, y);
      dragOriginal = draggedHandle ? {...draggedHandle.point} : null;
      return !!draggedHandle;
    },
    onEditMove(x, y) {
      if (!draggedHandle) return;
      const p = toGeo(x, y);
      if (p) Object.assign(draggedHandle.point, p);
      if (draggedHandle.routeId) state.activeRouteId = draggedHandle.routeId;
      sceneRevision++;
    },
    onEditEnd(cancelled) {
      if (draggedHandle && dragOriginal) {
        if (cancelled) { Object.assign(draggedHandle.point, dragOriginal); sceneRevision++; }
        else persist();
      }
      draggedHandle = null; dragOriginal = null;
    },
    onTap(screenX, screenY) {
      // Always check boat tap first (for follow camera)
      if (!state.editTool) {
        // Tapping a boat toggles following it; tapping open water stops following.
        const boat = hitTestBoat(screenX, screenY);
        state.followBoatId = boat && state.followBoatId !== boat.id ? boat.id : null;
        return;
      }

      const geo = toGeo(screenX, screenY);
      if (!geo) return;

      switch (state.editTool) {
        case 'buoy': {
          const hit = hitTestBuoy(screenX, screenY);
          if (hit) { removeBuoy(hit.id); return; }
          addBuoy(geo.lat, geo.lon);
          break;
        }
        case 'finish': {
          if (pickHandle(state, toScreen, screenX, screenY)) return;
          if (!state.finishLine.p1) {
            state.finishLine.p1 = { lat: geo.lat, lon: geo.lon };
          } else if (!state.finishLine.p2) {
            state.finishLine.p2 = { lat: geo.lat, lon: geo.lon };
          } else {
            state.finishLine.p1 = { lat: geo.lat, lon: geo.lon };
            state.finishLine.p2 = null;
          }
          break;
        }
        case 'maintenance': {
          if (pickHandle(state, toScreen, screenX, screenY)) return;
          state.maintenanceArea.push({ lat: geo.lat, lon: geo.lon });
          break;
        }
        case 'waiting': {
          if (pickHandle(state, toScreen, screenX, screenY)) return;
          if (state.waitingArea.length < 300) state.waitingArea.push(geo);
          break;
        }
        case 'route': {
          const handle = pickHandle(state, toScreen, screenX, screenY);
          if (handle?.routeId) { state.activeRouteId = handle.routeId; sceneRevision++; return; }
          if (insertRoutePoint(state, toScreen, screenX, screenY, geo)) break;
          ensureActiveRoute(currentRouteColor);
          const route = getActiveRoute();
          if (route && route.points.length < 2000) route.points.push({ lat: geo.lat, lon: geo.lon });
          break;
        }
      }
      persist();
    },
  });

  // --- Simulation (runs inside requestAnimationFrame with delta time) ---
  let trailAccum = 0;
  const TRAIL_INTERVAL = 400; // 2.5 samples per second, capped at 100 points per boat

  function tick(dt: number) {
    if (live) return;
    tickSimulation(dt);

    // Trail points at fixed interval (not every frame)
    trailAccum += dt;
    if (trailAccum >= TRAIL_INTERVAL) {
      trailAccum -= TRAIL_INTERVAL;
      for (const boat of state.boats) {
        boat.trail.push([boat.lat, boat.lon]);
        if (boat.trail.length > config.maxTrailLength) boat.trail.shift();
      }
    }

  }

  function followCamera() {
    // Follow selected boat
    if (state.followBoatId && !state.dragging) {
      const followed = state.boats.find((b) => b.id === state.followBoatId);
      if (followed) {
        const w = geoToWorld(followed.lat, followed.lon);
        const dx = w.x - state.worldCX;
        const dy = w.y - state.worldCY;
        const dist = Math.hypot(dx, dy);
        const t = dist > 0.0001 ? 1 : 0.35;
        state.worldCX += dx * t;
        state.worldCY += dy * t;

        callbacks.onTelemetryUpdate?.(
          followed.id, followed.lat, followed.lon,
          followed.speed, followed.heading,
        );
      }
    }
  }

  // --- Unified render loop ---
  let lastTime = 0;
  let lastFleetTime = -1000;
  let lastSelection: string | null | undefined;
  let backgroundKey = '';
  let backgroundCX = state.worldCX, backgroundCY = state.worldCY;
  let renderedTileRevision = -1;
  let previousSceneKey = '';
  let overlayHidden = false;
  const labelLayout = new LabelLayout();

  function frame(time: number) {
    if (!running) return;
    const interpolating=!view3D && live && [...liveMotion.values()].some(m=>m.isMoving(time));
    measureVsync(time);
    const interactive = state.dragging || time < activeUntil || !!view3D?.moving;
    let interval: number;
    if (view3D) {
      // Interactive: every refresh up to 60 fps (90 on a 90 Hz screen), halved on a struggling device; eco: 30.
      const full = paced(60) * (view3D.halfRate ? 2 : 1);
      const eco = paced(ECO_FPS) < 28 ? 2 * paced(ECO_FPS) : paced(ECO_FPS);
      interval = state.reducedMotion ? paced(15) : uiBusy || !interactive ? Math.max(full, eco) : full;
    } else interval = 1000 / (state.reducedMotion?15:interpolating||state.dragging?60:live?15:30);
    // Diagnostics for on-device tuning (read by test scripts, invisible to users).
    if (canvas.dataset && time - lastFleetTime > 450) { canvas.dataset.vsync = vsync.toFixed(1); canvas.dataset.interval = interval.toFixed(1); }
    if (lastTime && time - lastTime < interval - (view3D ? vsync / 2 : 1)) {
      if (view3D) schedule(interval - (time - lastTime));
      else rafId = requestAnimationFrame(frame);
      return;
    }
    const dt = lastTime ? Math.min(time - lastTime, 100) : 16; // cap at 100ms
    lastTime = time;

    if (!state.paused) {
      const elapsed=live?dt:dt*demoSpeed;
      state.animationTime += elapsed;
      tick(elapsed);
    }
    if(live)for(const boat of state.boats){
      const pose=liveMotion.get(boat.id)?.sample(time,state.reducedMotion);
      if(pose){boat.lat=pose.lat;boat.lon=pose.lon;boat.heading=pose.heading;}
    }
    followCamera();
    if(!view3D){
    const key = `${viewportRevision}/${state.width}/${state.height}/${state.zoom}/${state.style}`;
    const scale = 2 ** state.zoom * config.tileSize;
    let offsetX = (backgroundCX - state.worldCX) * scale;
    let offsetY = (backgroundCY - state.worldCY) * scale;
    if (key !== backgroundKey || Math.abs(offsetX) > BACKGROUND_MARGIN / 2 || Math.abs(offsetY) > BACKGROUND_MARGIN / 2 || (state.style === 'satellite' && tiles.revision !== renderedTileRevision)) {
      renderBackground(backgroundCtx, {...state, width: state.width + BACKGROUND_MARGIN * 2, height: state.height + BACKGROUND_MARGIN * 2}, config, tiles);
      backgroundCX = state.worldCX; backgroundCY = state.worldCY;
      offsetX = 0; offsetY = 0;
      backgroundKey = key;
      renderedTileRevision = tiles.revision;
    }
    background.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
    const sceneKey = `${key}/${state.worldCX}/${state.worldCY}/${sceneRevision}/${state.followBoatId}/${state.paused}`;
    const sceneChanged = !state.paused || sceneKey !== previousSceneKey;
    if (overlayHidden) { overlayHidden = false; canvas.style.opacity = ''; }
    if (sceneChanged) {
      renderFrame(ctx, state, config);
      // The 3D scene draws its own names; the 2D map stamps them onto its canvas.
      const named = state.boats.map(b => {const p = geoToScreen(b.lat, b.lon, state.worldCX, state.worldCY, state.zoom, config.tileSize, state.width, state.height);
        return {id: b.id, label: b.label, type: b.type, x: p.x, y: p.y, speed: b.speed, isFollowed: b.id === state.followBoatId, accentColor: b.accentColor, size: 44};});
      if (typeof document !== 'undefined' && 'createElement' in document) drawLabels(ctx, labelLayout.layout(named, state.width, state.height, time, state.dpr), state.dpr);
    }
    previousSceneKey = sceneKey;
    }else {
      view3D.render(state,config,time,interval,interactive&&!uiBusy);
      // In 3D the 2D canvas only carries edit handles. Otherwise leave it untouched and invisible:
      // clearing it every frame made the compositor blend a full-screen transparent layer each frame.
      if(state.editTool){if(overlayHidden){overlayHidden=false;canvas.style.opacity='';}view3D.renderOverlay(ctx,state);}
      else if(!overlayHidden){overlayHidden=true;ctx.clearRect(0,0,state.width,state.height);canvas.style.opacity='0';}
    }
    callbacks.onView?.(view3D?view3D.heading:null,!!view3D&&(Math.abs(view3D.tilt-(state.followBoatId?63:74))>1||state.pitch!==null));
    if (lastSelection !== state.followBoatId) {
      lastSelection = state.followBoatId;
      callbacks.onSelectionChange?.(lastSelection);
    }
    if (time - lastFleetTime > 500) {
      callbacks.onFleetUpdate?.(state.boats.map(b => ({...b, trail: []})));
      lastFleetTime = time;
    }


    if (view3D) schedule(interval - (now() - time));
    else rafId = requestAnimationFrame(frame);
  }

  function visibility() {
    cancelAnimationFrame(rafId);if(wakeTimer!==undefined){clearTimeout(wakeTimer);wakeTimer=undefined;}backToBack=false;
    lastTime = 0;view3D?.resetClock();
    if (!document.hidden && running) rafId = requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange', visibility);
  rafId = requestAnimationFrame(frame);

  return {
    async set3D(target) {
      const generation=++viewGeneration;
      view3D?.dispose();view3D=null;previousSceneKey='';backgroundKey='';
      if(!target)return false;
      try{
        const {RaceScene}=await import('./three/scene');
        if(!running || generation!==viewGeneration)return false;
        view3D=new RaceScene(target,()=>{view3D?.dispose();view3D=null;backgroundKey='';callbacks.on3DFallback?.();},tiles);
        view3D.setLighting(lighting);view3D.setPhotographic(photographic);wake();return true;
      }catch{callbacks.on3DFallback?.();return false;}
    },
    setLighting(mode){lighting=mode;view3D?.setLighting(mode);},
    setPhotographic(enabled){photographic=enabled;view3D?.setPhotographic(enabled);},
    setDemoSpeed(speed){demoSpeed=[1,2,4].includes(speed)?speed:1;},
    resetView(){state.bearing=0;state.pitch=null;wake();},
    selectVenue(id) {
      const venue = venueById(id);
      if (venue.id === state.venueId) return;
      // Another venue: its published course if it is the live one, otherwise its model.
      showCourse(liveCourse.venue === venue.id ? liveCourse : {venue: venue.id, course: venue.id === 'imboassica' ? COURSE_PRESETS[0].id : 'custom', geometry: null, areas: null, updatedAt: ''}, true);
      callbacks.onSelectionChange?.(null);
    },
    setLiveBoats(updates) {
      if (!live) return;
      const palette: Record<string,string> = {blue:'#2f86ff',purple:'#a371ff',green:'#7bd63a',orange:'#ff7a1f',red:'#ff4d4f',yellow:'#ffc629',gold:'#ffc629',cyan:'#41d6f5'};
      const now=performance.now();
      state.boats = updates.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat)<85 && Math.abs(p.lon)<=180).map(p => {
        const old = state.boats.find(b => b.id === p.id);
        if(old && Date.parse(p.capturedAt)<Date.parse(old.capturedAt ?? ''))return old;
        let animator=liveMotion.get(p.id);
        const fix={lat:p.lat,lon:p.lon,heading:p.heading ?? old?.heading ?? 0,time:Date.parse(p.capturedAt)};
        let continuous=true;
        if(animator){if(old?.capturedAt!==p.capturedAt)continuous=animator.push(fix,now);}
        else {animator=new LiveMotion(fix,now);liveMotion.set(p.id,animator);}
        const pose=animator.sample(now,state.reducedMotion);
        const trail = old && continuous ? [...old.trail] : [];
        if (old && continuous && old.capturedAt !== p.capturedAt) trail.push([old.lat,old.lon]);
        return {id:p.id,label:p.label,lat:pose.lat,lon:pose.lon,capturedAt:p.capturedAt,
          type:p.hull ?? 'cat',motors:p.motors ?? 1,logo:logoUrl(p.logo),activity:'racing',raceRouteId:null,hullColor:'#ffffff',accentColor:palette[p.color] || palette.blue,
          heading:pose.heading,headingTarget:p.heading ?? old?.heading ?? 0,
          speed:isRecentPosition(p.capturedAt) ? (p.speed ?? 0) : 0,speedKnown:p.speed!==null,
          baseSpeed:0,speedPhaseOffset:0,routeIndex:0,routeT:0,trail:trail.slice(-config.maxTrailLength)};
      });
      for(const id of liveMotion.keys())if(!state.boats.some(b=>b.id===id))liveMotion.delete(id);
      if (!state.boats.some(b=>b.id===state.followBoatId)) state.followBoatId=null;
      sceneRevision++;
      callbacks.onFleetUpdate?.(state.boats.map(b=>({...b,trail:[]})));
    },
    applyLiveCourse(course) {
      if (presentationDemo) return;
      const moved = course.venue !== liveCourse.venue || course.course !== liveCourse.course;
      liveCourse = course; cacheCourse(course);
      // An open edit session keeps the organizer's working copy on screen.
      if (!editingSession) showCourse(course, moved);
    },
    beginEdit() { editingSession = true; },
    endEdit() {
      editingSession = false; state.editTool = null;
      const moved = liveCourse.venue !== state.venueId || liveCourse.course !== state.courseId;
      showCourse(liveCourse, moved);
    },
    loadCourse(venue, course, geometry, areas) {
      showCourse({venue, course, geometry, areas, updatedAt: ''}, true);
    },
    resetCourse() { Object.assign(state, copyCourse({...resolveCourse({venue: state.venueId ?? 'imboassica', course: state.courseId, geometry: null, areas: null, updatedAt: ''}), maintenanceArea: state.maintenanceArea, waitingArea: state.waitingArea})); selectFirstRoute(); renumberBuoys(); persist(); },
    undoCourse() {
      const previous = history.pop();
      if (!previous) return;
      Object.assign(state, previous); selectFirstRoute(); renumberBuoys(); persist(false);
    },
    fit,
    zoom(delta) { state.zoom = Math.max(config.zoomMin, Math.min(config.zoomMax, state.zoom + delta)); wake(); },
    follow(id) { state.followBoatId = state.boats.some(b => b.id === id) ? id : null; wake(); },
    setStyle(style) { state.style = style; },
    setPaused(paused) { state.paused = paused; },
    setUiBusy(busy) { uiBusy = busy; if (!busy) wake(); },
    addBuoy,
    removeBuoy,
    getBuoys: () => [...state.buoys],
    setEditTool(tool: EditTool) {
      if (state.editTool === 'buoy' && tool !== 'buoy') renumberBuoys();
      if (state.editTool === 'route' && tool !== 'route') state.activeRouteId = null;
      state.editTool = tool;
      if (tool === 'route' && !state.activeRouteId) selectFirstRoute();
      persist();
    },
    clearFinishLine() { state.finishLine = { p1: null, p2: null }; persist(); },
    clearMaintenanceArea() { state.maintenanceArea = []; persist(); },
    clearWaitingArea() { state.waitingArea = []; persist(); },
    newRoute(color: string) {
      currentRouteColor = color;
      state.activeRouteId = null;
    },
    undoRoutePoint() {
      const route = getActiveRoute();
      if (route && route.points.length > 0) {
        route.points.pop();
        if (route.points.length === 0) {
          state.routes = state.routes.filter((r) => r.id !== route.id);
          state.activeRouteId = null;
        }
      }
      persist();
    },
    deleteRoute(id: string) {
      state.routes = state.routes.filter((r) => r.id !== id);
      if (state.activeRouteId === id) state.activeRouteId = null;
      persist();
    },
    deleteActiveRoute() {
      if (!getActiveRoute()) return;
      state.routes = state.routes.filter((r) => r.id !== state.activeRouteId);
      selectFirstRoute();
      persist();
    },
    clearAllRoutes() { state.routes = []; state.activeRouteId = null; persist(); },
    destroy() {
      running = false;viewGeneration++;view3D?.dispose();view3D=null;
      cancelAnimationFrame(rafId);if(wakeTimer!==undefined)clearTimeout(wakeTimer);
      for (const evt of ['pointerdown', 'pointermove', 'wheel', 'touchstart'] as const) canvas.removeEventListener?.(evt, wake);
      window.removeEventListener('resize', resize);
      detachInput();
      tiles.destroy();
      motion.removeEventListener('change', updateMotion);
      document.removeEventListener('visibilitychange', visibility);
    },
  };
}
