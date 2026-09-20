import type { MapState, MapConfig, Buoy, Boat, EditTool, BoatType } from './types';
import { geoToWorld, geoToScreen, screenToGeo, bearing } from './geo';
import { TileCache } from './tiles';
import { renderFrame, renderBackground } from './renderer';
import { attachInputHandlers } from './input';
import { DEFAULT_CONFIG, ROUTE_COLORS } from './types';
import { restoreCourse, saveCourse, validCourseId } from './storage';
import { COURSE_PRESETS, copyCourse, defaultCourse, type Course } from './courses';
import { pickHandle, insertRoutePoint } from './editing';
import { createSimulation } from './simulation';

// Demo route (circular path)
export const DEMO_ROUTE: [number, number][] = [
  [-22.414654, -41.818751], [-22.414, -41.8172], [-22.4132, -41.8158],
  [-22.4122, -41.8148], [-22.411, -41.8144], [-22.4098, -41.8148],
  [-22.4088, -41.8158], [-22.4082, -41.8172], [-22.408, -41.819],
  [-22.4084, -41.8208], [-22.4094, -41.8222], [-22.4106, -41.823],
  [-22.412, -41.8226], [-22.4132, -41.8216], [-22.4142, -41.82],
];

export const BOAT_DEFS: { id: string; label: string; type: BoatType; hull: string; accent: string; baseSpeed: number; startOffset: number }[] = [
  // Competidores
  { id: 'b1', label: 'Barco 1', type: 'cat',  hull: '#ffffff', accent: '#187cc1', baseSpeed: 8.5, startOffset: 0 },
  { id: 'b2', label: 'Barco 2', type: 'mono', hull: '#ffe066', accent: '#d7a02a', baseSpeed: 7.8, startOffset: 0.06 },
  { id: 'b3', label: 'Barco 3', type: 'cat',  hull: '#ff6666', accent: '#d36551', baseSpeed: 9.0, startOffset: 0.12 },
  { id: 'b4', label: 'Barco 4', type: 'mono', hull: '#66ff99', accent: '#328868', baseSpeed: 7.2, startOffset: 0.18 },
  { id: 'b5', label: 'Barco 5', type: 'cat',   hull: '#cc99ff', accent: '#8c70b6', baseSpeed: 8.0, startOffset: 0.24 },
  { id: 'b6', label: 'Barco 6', type: 'mono', hull: '#ffffff', accent: '#d88039',    baseSpeed: 8.2, startOffset: 0.30 },
  // Suporte
  { id: 's1', label: 'Jet Ski Resgate', type: 'jetski',  hull: '#ff4444', accent: '#d36551', baseSpeed: 12.0, startOffset: 0.40 },
  { id: 's2', label: 'Barco Suporte',   type: 'support', hull: '#f0f0f0', accent: '#ff6600', baseSpeed: 10.0, startOffset: 0.55 },
  { id: 's3', label: 'Jet Ski Resgate 2', type: 'jetski', hull: '#ff4444', accent: '#d36551', baseSpeed: 11.5, startOffset: 0.70 },
];

const BUOY_HIT_RADIUS = 20;
const BOAT_HIT_RADIUS = 22;

export interface BoatScreenInfo {
  id: string;
  label: string;
  type: string;
  x: number;
  y: number;
  speed: number;
  isFollowed: boolean;
  accentColor: string;
}

export interface EngineCallbacks {
  onCourseChange?: (id: string, canUndo: boolean) => void;
  onSelectionChange?: (boatId: string | null) => void;
  onFleetUpdate?: (boats: Boat[]) => void;
  onSaveStatus?: (saved: boolean) => void;
  onTelemetryUpdate?: (boatId: string, lat: number, lon: number, speed: number, heading: number) => void;
  onBuoysChange?: (buoys: Buoy[]) => void;
  onBoatPositions?: (boats: BoatScreenInfo[]) => void;
}

export interface EngineAPI {
  selectCourse: (id: string) => boolean;
  resetCourse: () => void;
  undoCourse: () => void;
  fit: (padding?: Partial<Record<'left' | 'right' | 'top' | 'bottom', number>>) => void;
  zoom: (delta: number) => void;
  follow: (id: string | null) => void;
  setStyle: (style: MapState['style']) => void;
  setPaused: (paused: boolean) => void;
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
): EngineAPI {
  const ctx = canvas.getContext('2d')!;
  const backgroundCtx = background.getContext('2d', { alpha: false })!;
  const state = createMapState(config);
  restoreCourse(state);
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
    if (changed || simulatedCourseId !== state.courseId) {
      tickSimulation = createSimulation(state);
      simulatedCourseId = state.courseId;
      callbacks.onFleetUpdate?.(state.boats.map(b => ({...b, trail: []})));
    }
    callbacks.onSaveStatus?.(saveCourse(state));
    notifyCourse();
  }
  notifyCourse();

  let buoyIdCounter = Math.max(0, ...state.buoys.map(b => Number(b.id.split('-').pop()) || 0));
  let routeIdCounter = Math.max(0, ...state.routes.map(r => Number(r.id.split('-').pop()) || 0));
  const tiles = new TileCache(config);

  let rafId = 0;
  let running = true;

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

  function hitTestBuoy(screenX: number, screenY: number): Buoy | null {
    for (let i = state.buoys.length - 1; i >= 0; i--) {
      const b = state.buoys[i];
      const p = geoToScreen(
        b.lat, b.lon, state.worldCX, state.worldCY,
        state.zoom, config.tileSize, state.width, state.height,
      );
      const dx = p.x - screenX;
      const dy = p.y - screenY;
      if (dx * dx + dy * dy <= BUOY_HIT_RADIUS * BUOY_HIT_RADIUS) return b;
    }
    return null;
  }

  function hitTestBoat(screenX: number, screenY: number): Boat | null {
    for (let i = state.boats.length - 1; i >= 0; i--) {
      const boat = state.boats[i];
      const p = geoToScreen(
        boat.lat, boat.lon, state.worldCX, state.worldCY,
        state.zoom, config.tileSize, state.width, state.height,
      );
      const dx = p.x - screenX;
      const dy = p.y - screenY;
      if (dx * dx + dy * dy <= BOAT_HIT_RADIUS * BOAT_HIT_RADIUS) return boat;
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
    const nw = points.length ? geoToWorld(Math.max(...points.map(p => p.lat)) + .00025, Math.min(...points.map(p => p.lon)) - .00025) : geoToWorld(-22.4076, -41.824);
    const se = points.length ? geoToWorld(Math.min(...points.map(p => p.lat)) - .00025, Math.max(...points.map(p => p.lon)) + .00025) : geoToWorld(-22.4152, -41.8136);
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

  // --- Input ---
  const detachInput = attachInputHandlers(canvas, state, config, {
    onEditStart(x, y) {
      draggedHandle = pickHandle(state, config, x, y);
      dragOriginal = draggedHandle ? {...draggedHandle.point} : null;
      return !!draggedHandle;
    },
    onEditMove(x, y) {
      if (!draggedHandle) return;
      const p = screenToGeo(x, y, state.worldCX, state.worldCY, state.zoom, config.tileSize, state.width, state.height);
      Object.assign(draggedHandle.point, p);
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
        const boat = hitTestBoat(screenX, screenY);
        if (boat) {
          state.followBoatId = state.followBoatId === boat.id ? null : boat.id;
        }
        return;
      }

      const geo = screenToGeo(
        screenX, screenY, state.worldCX, state.worldCY,
        state.zoom, config.tileSize, state.width, state.height,
      );

      switch (state.editTool) {
        case 'buoy': {
          const hit = hitTestBuoy(screenX, screenY);
          if (hit) { removeBuoy(hit.id); return; }
          addBuoy(geo.lat, geo.lon);
          break;
        }
        case 'finish': {
          if (pickHandle(state, config, screenX, screenY)) return;
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
          if (pickHandle(state, config, screenX, screenY)) return;
          state.maintenanceArea.push({ lat: geo.lat, lon: geo.lon });
          break;
        }
        case 'waiting': {
          if (pickHandle(state, config, screenX, screenY)) return;
          if (state.waitingArea.length < 300) state.waitingArea.push(geo);
          break;
        }
        case 'route': {
          const handle = pickHandle(state, config, screenX, screenY);
          if (handle?.routeId) { state.activeRouteId = handle.routeId; sceneRevision++; return; }
          if (insertRoutePoint(state, config, screenX, screenY, geo)) break;
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

  function frame(time: number) {
    if (!running) return;
    const interval = state.reducedMotion ? 1000 / 15 : 1000 / 30;
    if (lastTime && time - lastTime < interval - 1) {
      rafId = requestAnimationFrame(frame);
      return;
    }
    const dt = lastTime ? Math.min(time - lastTime, 100) : 16; // cap at 100ms
    lastTime = time;

    if (!state.paused) {
      state.animationTime += dt;
      tick(dt);
    }
    followCamera();
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
    if (sceneChanged) renderFrame(ctx, state, config);
    previousSceneKey = sceneKey;
    if (lastSelection !== state.followBoatId) {
      lastSelection = state.followBoatId;
      callbacks.onSelectionChange?.(lastSelection);
    }
    if (time - lastFleetTime > 500) {
      callbacks.onFleetUpdate?.(state.boats.map(b => ({...b, trail: []})));
      lastFleetTime = time;
    }

    // Emit boat screen positions for DOM labels
    if (sceneChanged && callbacks.onBoatPositions) {
      const infos: BoatScreenInfo[] = [];
      for (const boat of state.boats) {
        const p = geoToScreen(
          boat.lat, boat.lon, state.worldCX, state.worldCY,
          state.zoom, config.tileSize, state.width, state.height,
        );
        infos.push({
          id: boat.id, label: boat.label, type: boat.type,
          x: p.x, y: p.y, speed: boat.speed,
          isFollowed: boat.id === state.followBoatId,
          accentColor: boat.accentColor,
        });
      }
      callbacks.onBoatPositions(infos);
    }

    rafId = requestAnimationFrame(frame);
  }

  function visibility() {
    cancelAnimationFrame(rafId);
    lastTime = 0;
    if (!document.hidden && running) rafId = requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange', visibility);
  rafId = requestAnimationFrame(frame);

  return {
    selectCourse(id) {
      if (!validCourseId(id)) return false;
      if (!saveCourse(state)) { callbacks.onSaveStatus?.(false); return false; }
      restoreCourse(state, id);
      history.length = 0;
      state.activeRouteId = null; state.editTool = null;
      buoyIdCounter = Math.max(0, ...state.buoys.map(b => Number(b.id.split('-').pop()) || 0));
      routeIdCounter = Math.max(0, ...state.routes.map(r => Number(r.id.split('-').pop()) || 0));
      recycledNumbers.length = 0;
      nextBuoyNumber = Math.max(0, ...state.buoys.map(b => b.number)) + 1;
      state.boats.forEach(b => { b.trail = []; });
      fit(); persist(false);
      return true;
    },
    resetCourse() { Object.assign(state, defaultCourse(state.courseId), {maintenanceArea: state.maintenanceArea, waitingArea: state.waitingArea}); state.activeRouteId = null; renumberBuoys(); fit(); persist(); },
    undoCourse() {
      const previous = history.pop();
      if (!previous) return;
      Object.assign(state, previous); state.activeRouteId = null; renumberBuoys(); persist(false);
    },
    fit,
    zoom(delta) { state.zoom = Math.max(config.zoomMin, Math.min(config.zoomMax, state.zoom + delta)); },
    follow(id) { state.followBoatId = state.boats.some(b => b.id === id) ? id : null; },
    setStyle(style) { state.style = style; },
    setPaused(paused) { state.paused = paused; },
    addBuoy,
    removeBuoy,
    getBuoys: () => [...state.buoys],
    setEditTool(tool: EditTool) {
      if (state.editTool === 'buoy' && tool !== 'buoy') renumberBuoys();
      if (state.editTool === 'route' && tool !== 'route') state.activeRouteId = null;
      if (tool === 'route' && !state.activeRouteId) state.activeRouteId = state.routes[0]?.id ?? null;
      state.editTool = tool;
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
    clearAllRoutes() { state.routes = []; state.activeRouteId = null; persist(); },
    destroy() {
      running = false;
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      detachInput();
      tiles.destroy();
      motion.removeEventListener('change', updateMotion);
      document.removeEventListener('visibilitychange', visibility);
    },
  };
}
