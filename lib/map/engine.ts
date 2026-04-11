import type { MapState, MapConfig, Buoy, Boat, EditTool } from './types';
import { geoToWorld, geoToScreen, screenToGeo, bearing } from './geo';
import { TileCache } from './tiles';
import { renderFrame } from './renderer';
import { attachInputHandlers } from './input';
import { DEFAULT_CONFIG, ROUTE_COLORS } from './types';

// Demo route (circular path)
const DEMO_ROUTE: [number, number][] = [
  [-22.414654, -41.818751], [-22.414, -41.8172], [-22.4132, -41.8158],
  [-22.4122, -41.8148], [-22.411, -41.8144], [-22.4098, -41.8148],
  [-22.4088, -41.8158], [-22.4082, -41.8172], [-22.408, -41.819],
  [-22.4084, -41.8208], [-22.4094, -41.8222], [-22.4106, -41.823],
  [-22.412, -41.8226], [-22.4132, -41.8216], [-22.4142, -41.82],
  [-22.414654, -41.818751],
];

const BOAT_DEFS: { id: string; label: string; hull: string; accent: string; baseSpeed: number; startOffset: number }[] = [
  { id: 'b1', label: 'Barco 1', hull: '#ffffff', accent: '#00aaff', baseSpeed: 8.5, startOffset: 0 },
  { id: 'b2', label: 'Barco 2', hull: '#ffe066', accent: '#e6a800', baseSpeed: 7.8, startOffset: 0.06 },
  { id: 'b3', label: 'Barco 3', hull: '#ff6666', accent: '#cc0000', baseSpeed: 9.0, startOffset: 0.12 },
  { id: 'b4', label: 'Barco 4', hull: '#66ff99', accent: '#00b33c', baseSpeed: 7.2, startOffset: 0.18 },
  { id: 'b5', label: 'Barco 5', hull: '#cc99ff', accent: '#7733cc', baseSpeed: 8.0, startOffset: 0.24 },
];

const BUOY_HIT_RADIUS = 20;
const BOAT_HIT_RADIUS = 22;

export interface EngineCallbacks {
  onTelemetryUpdate?: (boatId: string, lat: number, lon: number, speed: number, heading: number) => void;
  onBuoysChange?: (buoys: Buoy[]) => void;
}

export interface EngineAPI {
  addBuoy: (lat: number, lon: number) => Buoy;
  removeBuoy: (id: string) => void;
  getBuoys: () => Buoy[];
  setEditTool: (tool: EditTool) => void;
  clearFinishLine: () => void;
  clearMaintenanceArea: () => void;
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
      id: def.id,
      label: def.label,
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
    lastPinchDist: 0,
    pinchMidX: 0,
    pinchMidY: 0,
    followBoatId: null,
    boats: createBoats(),
    buoys: [],
    finishLine: { p1: null, p2: null },
    maintenanceArea: [],
    routes: [],
    activeRouteId: null,
    editTool: null,
  };
}

/** Initialize the map engine on a canvas element. Returns an API object. */
export function initEngine(
  canvas: HTMLCanvasElement,
  config: MapConfig = DEFAULT_CONFIG,
  callbacks: EngineCallbacks = {},
): EngineAPI {
  const ctx = canvas.getContext('2d')!;
  const state = createMapState(config);

  let buoyIdCounter = 0;
  let routeIdCounter = 0;
  const tiles = new TileCache(config);

  let rafId = 0;
  let tickId = 0;
  let running = true;

  const recycledNumbers: number[] = [];
  let nextBuoyNumber = 1;

  function notifyBuoys() {
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

  // --- Resize ---
  function resize() {
    state.dpr = devicePixelRatio || 1;
    state.width = window.innerWidth;
    state.height = window.innerHeight;
    canvas.width = state.width * state.dpr;
    canvas.height = state.height * state.dpr;
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  }

  resize();
  window.addEventListener('resize', resize);

  let currentRouteColor = ROUTE_COLORS[0].hex;

  // --- Input ---
  const detachInput = attachInputHandlers(canvas, state, config, {
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
          state.maintenanceArea.push({ lat: geo.lat, lon: geo.lon });
          break;
        }
        case 'route': {
          ensureActiveRoute(currentRouteColor);
          const route = getActiveRoute();
          if (route) route.points.push({ lat: geo.lat, lon: geo.lon });
          break;
        }
      }
    },
  });

  // --- Simulation tick ---
  function tickBoat(boat: Boat) {
    const speedVar = boat.baseSpeed + Math.sin(Date.now() / 3000 + boat.speedPhaseOffset) * 2;
    // Faster boats advance quicker along the route
    const advance = 0.0012 + (speedVar - 6) * 0.0002;

    boat.routeT += advance;
    if (boat.routeT >= 1) {
      boat.routeT -= 1;
      boat.routeIndex = (boat.routeIndex + 1) % DEMO_ROUTE.length;
    }
    const from = DEMO_ROUTE[boat.routeIndex % DEMO_ROUTE.length];
    const to = DEMO_ROUTE[(boat.routeIndex + 1) % DEMO_ROUTE.length];
    boat.lat = from[0] + (to[0] - from[0]) * boat.routeT;
    boat.lon = from[1] + (to[1] - from[1]) * boat.routeT;

    boat.headingTarget = bearing(from, to);
    let diff = boat.headingTarget - boat.heading;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    boat.heading += diff * 0.08;
    boat.heading = ((boat.heading % 360) + 360) % 360;

    boat.speed = speedVar;

    boat.trail.push([boat.lat, boat.lon]);
    if (boat.trail.length > config.maxTrailLength) boat.trail.shift();
  }

  function tick() {
    for (const boat of state.boats) {
      tickBoat(boat);
    }

    // Follow selected boat
    if (state.followBoatId) {
      const followed = state.boats.find((b) => b.id === state.followBoatId);
      if (followed) {
        const w = geoToWorld(followed.lat, followed.lon);
        const dx = w.x - state.worldCX;
        const dy = w.y - state.worldCY;
        const dist = Math.hypot(dx, dy);
        // Snap when far, smooth only when very close
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

  // --- Render loop ---
  function render() {
    if (!running) return;
    renderFrame(ctx, state, config, tiles);
    rafId = requestAnimationFrame(render);
  }

  tickId = window.setInterval(tick, 50);
  rafId = requestAnimationFrame(render);

  return {
    addBuoy,
    removeBuoy,
    getBuoys: () => [...state.buoys],
    setEditTool(tool: EditTool) {
      if (state.editTool === 'buoy' && tool !== 'buoy') renumberBuoys();
      if (state.editTool === 'route' && tool !== 'route') state.activeRouteId = null;
      state.editTool = tool;
    },
    clearFinishLine() { state.finishLine = { p1: null, p2: null }; },
    clearMaintenanceArea() { state.maintenanceArea = []; },
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
    },
    deleteRoute(id: string) {
      state.routes = state.routes.filter((r) => r.id !== id);
      if (state.activeRouteId === id) state.activeRouteId = null;
    },
    clearAllRoutes() { state.routes = []; state.activeRouteId = null; },
    destroy() {
      running = false;
      cancelAnimationFrame(rafId);
      clearInterval(tickId);
      window.removeEventListener('resize', resize);
      detachInput();
    },
  };
}
