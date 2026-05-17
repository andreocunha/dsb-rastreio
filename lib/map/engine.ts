import type { MapState, MapConfig, Buoy, Boat, EditTool, BoatType } from './types';
import { geoToWorld, geoToScreen, screenToGeo, bearing } from './geo';
import { TileCache } from './tiles';
import { renderFrame } from './renderer';
import { attachInputHandlers } from './input';
import { DEFAULT_CONFIG, ROUTE_COLORS } from './types';
import { RealtimeSource, type HistoryRequester } from '@/lib/realtime/source';
import type { PositionUpdate, InitMessage, HistoryMessage } from '@/lib/realtime/types';

// Below this segment speed (m/s) we keep the previous heading. GPS noise on a
// near-stationary boat produces a meaningless bearing that would spin the icon.
const MIN_SPEED_FOR_HEADING_MPS = 0.5;
const MPS_TO_KNOTS = 1.943844;

// Demo route (circular path)
const DEMO_ROUTE: [number, number][] = [
  [-22.414654, -41.818751], [-22.414, -41.8172], [-22.4132, -41.8158],
  [-22.4122, -41.8148], [-22.411, -41.8144], [-22.4098, -41.8148],
  [-22.4088, -41.8158], [-22.4082, -41.8172], [-22.408, -41.819],
  [-22.4084, -41.8208], [-22.4094, -41.8222], [-22.4106, -41.823],
  [-22.412, -41.8226], [-22.4132, -41.8216], [-22.4142, -41.82],
  [-22.414654, -41.818751],
];

const BOAT_DEFS: { id: string; label: string; type: BoatType; hull: string; accent: string; baseSpeed: number; startOffset: number }[] = [
  // Competidores
  { id: 'b1', label: 'Barco 1', type: 'cat',  hull: '#ffffff', accent: '#00aaff', baseSpeed: 8.5, startOffset: 0 },
  { id: 'b2', label: 'Barco 2', type: 'mono', hull: '#ffe066', accent: '#e6a800', baseSpeed: 7.8, startOffset: 0.06 },
  { id: 'b3', label: 'Barco 3', type: 'cat',  hull: '#ff6666', accent: '#cc0000', baseSpeed: 9.0, startOffset: 0.12 },
  { id: 'b4', label: 'Barco 4', type: 'mono', hull: '#66ff99', accent: '#00b33c', baseSpeed: 7.2, startOffset: 0.18 },
  { id: 'b5', label: 'Barco 5', type: 'cat',   hull: '#cc99ff', accent: '#7733cc', baseSpeed: 8.0, startOffset: 0.24 },
  { id: 'b6', label: 'Barco 6', type: 'arrow', hull: '#ffffff', accent: '#0af',    baseSpeed: 8.2, startOffset: 0.30 },
  // Suporte
  { id: 's1', label: 'Jet Ski Resgate', type: 'jetski',  hull: '#ff4444', accent: '#cc0000', baseSpeed: 12.0, startOffset: 0.40 },
  { id: 's2', label: 'Barco Suporte',   type: 'support', hull: '#f0f0f0', accent: '#ff6600', baseSpeed: 10.0, startOffset: 0.55 },
  { id: 's3', label: 'Jet Ski Resgate 2', type: 'jetski', hull: '#ff4444', accent: '#cc0000', baseSpeed: 11.5, startOffset: 0.70 },
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
  onTelemetryUpdate?: (boatId: string, lat: number, lon: number, speed: number, heading: number) => void;
  onBuoysChange?: (buoys: Buoy[]) => void;
  onBoatPositions?: (boats: BoatScreenInfo[]) => void;
}

export interface PlayheadInfo {
  /** True when playhead tracks live (latest data minus the interp delay). */
  isLive: boolean;
  /** Current playhead server time. */
  playheadT: number;
  /** Server time of the first sample of the race. 0 = race hasn't started. */
  raceStartT: number;
  /** Server time of the latest live sample we've seen. */
  liveT: number;
  /** True while a history chunk request is outstanding. */
  isLoading: boolean;
  /** True if playhead currently has data; false during loading after a seek into uncovered range. */
  hasDataAtPlayhead: boolean;
}

export type PlayheadListener = (info: PlayheadInfo) => void;

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

  // Realtime stream wiring
  setHistoryRequester: (fn: HistoryRequester | null) => void;
  ingestInit: (msg: InitMessage) => void;
  ingestLive: (updates: PositionUpdate[]) => void;
  ingestHistory: (msg: HistoryMessage) => void;

  // DVR controls
  /** Seek to a specific server time, or pass null to return to live. */
  setPlayhead: (serverT: number | null) => void;
  getPlayheadInfo: () => PlayheadInfo;
  /** Subscribe to playhead/loading changes. Returns unsubscribe. */
  onPlayhead: (fn: PlayheadListener) => () => void;

  getMode: () => 'simulation' | 'realtime';
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
      isStale: false,
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
    followBoatId: null,
    activeZi: 17,
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
  const realtime = new RealtimeSource();
  let mode: 'simulation' | 'realtime' = 'simulation';

  // DVR state
  // - playheadServerT === null  → live mode, playhead = realtime.liveRenderT()
  // - playheadServerT !== null  → DVR; advances at real-time rate each frame
  //   until it catches up to liveRenderT, at which point we drop back to null.
  let playheadServerT: number | null = null;
  let prevPlayheadT = 0;
  let prevHasData = false;
  const playheadListeners = new Set<PlayheadListener>();
  let lastEmittedSig = '';

  function currentPlayheadT(): number {
    return playheadServerT ?? realtime.liveRenderT();
  }

  function getPlayheadInfo(): PlayheadInfo {
    const playheadT = currentPlayheadT();
    return {
      isLive: playheadServerT === null,
      playheadT,
      raceStartT: realtime.raceStartT(),
      liveT: realtime.liveRenderT(),
      isLoading: realtime.isLoading(),
      hasDataAtPlayhead: realtime.hasDataAt(playheadT),
    };
  }

  function emitPlayheadIfChanged() {
    if (playheadListeners.size === 0) return;
    const info = getPlayheadInfo();
    // Cheap signature to avoid spamming listeners with identical info.
    const sig = `${info.isLive ? 1 : 0}|${Math.floor(info.playheadT / 250)}|${info.isLoading ? 1 : 0}|${info.hasDataAtPlayhead ? 1 : 0}|${Math.floor(info.liveT / 250)}|${info.raceStartT}`;
    if (sig === lastEmittedSig) return;
    lastEmittedSig = sig;
    for (const l of playheadListeners) l(info);
  }

  let rafId = 0;
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

  // --- Simulation (runs inside requestAnimationFrame with delta time) ---
  const TICK_RATE = 50; // base simulation rate in ms
  let trailAccum = 0;
  const TRAIL_INTERVAL = 50; // add trail point every 50ms

  function dampHeading(boat: Boat, dt: number, factor: number) {
    let diff = boat.headingTarget - boat.heading;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    boat.heading += diff * Math.min(1, factor * (dt / TICK_RATE));
    boat.heading = ((boat.heading % 360) + 360) % 360;
  }

  function tickBoatSim(boat: Boat, dt: number) {
    const now = Date.now();
    const speedVar = boat.baseSpeed + Math.sin(now / 3000 + boat.speedPhaseOffset) * 2;
    const advance = (0.0012 + (speedVar - 6) * 0.0002) * (dt / TICK_RATE);

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
    dampHeading(boat, dt, 0.08);
    boat.speed = speedVar;
  }

  function tickBoatRealtime(boat: Boat, dt: number, playheadT: number) {
    const sample = realtime.sampleBoatAt(boat.id, playheadT);
    if (sample) {
      boat.lat = sample.lat;
      boat.lon = sample.lon;
      if (sample.bearing !== null && sample.speedMps >= MIN_SPEED_FOR_HEADING_MPS) {
        boat.headingTarget = sample.bearing;
      }
      boat.speed = sample.speedMps * MPS_TO_KNOTS;
      boat.isStale = sample.extrapolating;
    } else {
      // No data for this boat at all — treat as stale so the trail pauses.
      boat.isStale = true;
    }
    dampHeading(boat, dt, 0.12);
  }

  function tickBoat(boat: Boat, dt: number, playheadT: number) {
    if (mode === 'realtime') tickBoatRealtime(boat, dt, playheadT);
    else tickBoatSim(boat, dt);
  }

  /**
   * Rebuild each boat's trail from history. Used after a large playhead jump
   * (user scrubbed). Samples every TRAIL_INTERVAL ms going back from playheadT.
   * Stale/null samples are skipped, naturally leaving time gaps that the
   * renderer renders as broken trail segments.
   */
  function regenerateTrails(playheadT: number) {
    const N = config.maxTrailLength;
    for (const boat of state.boats) {
      boat.trail.length = 0;
      // Walk forward in time so the array stays sorted by t.
      for (let i = N - 1; i >= 0; i--) {
        const t = playheadT - i * TRAIL_INTERVAL;
        const s = realtime.sampleBoatAt(boat.id, t);
        if (!s || s.extrapolating) continue;
        boat.trail.push([s.lat, s.lon, t]);
      }
      // The boat's currently-displayed position is sampled at playheadT in
      // tickBoatRealtime — the last regen point above already covers that.
    }
  }

  function tick(dt: number, playheadT: number) {
    for (const boat of state.boats) {
      tickBoat(boat, dt, playheadT);
    }

    // Trail points at fixed interval — record the current boat position with
    // the *playhead* timestamp so the time axis is consistent across live and
    // DVR, and the renderer's gap-detection works either way.
    trailAccum += dt;
    if (trailAccum >= TRAIL_INTERVAL) {
      trailAccum -= TRAIL_INTERVAL;
      const stampT = mode === 'realtime' ? playheadT : Date.now();
      for (const boat of state.boats) {
        if (boat.isStale) continue;
        boat.trail.push([boat.lat, boat.lon, stampT]);
        if (boat.trail.length > config.maxTrailLength) boat.trail.shift();
      }
    }

    // Follow selected boat
    if (state.followBoatId) {
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

  function frame(time: number) {
    if (!running) return;
    const dt = lastTime ? Math.min(time - lastTime, 100) : 16; // cap at 100ms
    lastTime = time;

    // Advance DVR playhead at real-time rate. When it catches up to live, drop
    // back to live mode (so the LIVE button isn't needed if you let it run).
    if (playheadServerT !== null) {
      playheadServerT += dt;
      const liveT = realtime.liveRenderT();
      if (playheadServerT >= liveT - 200) {
        playheadServerT = null;
      }
    }

    const playheadT = currentPlayheadT();

    const hasData = realtime.hasDataAt(playheadT);
    // Regenerate trails on a significant playhead jump (user seeked) AND on
    // the false→true data-availability transition (chunk just arrived after
    // a seek into uncovered range, so the first regen had nothing to draw).
    if (mode === 'realtime') {
      const jumped = Math.abs(playheadT - prevPlayheadT) > 200;
      const dataJustArrived = hasData && !prevHasData;
      if (jumped || dataJustArrived) regenerateTrails(playheadT);
    }
    prevPlayheadT = playheadT;
    prevHasData = hasData;

    // Cheap: only sends requests for genuine gaps within prefetch window.
    if (mode === 'realtime') realtime.ensureCoverage(playheadT);

    tick(dt, playheadT);
    emitPlayheadIfChanged();
    renderFrame(ctx, state, config, tiles);

    // Emit boat screen positions for DOM labels
    if (callbacks.onBoatPositions) {
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

  rafId = requestAnimationFrame(frame);

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

    setHistoryRequester(fn) {
      realtime.setRequester(fn);
    },
    ingestInit(msg) {
      realtime.ingestInit(msg);
      if (mode === 'simulation' && realtime.latestLiveT() > 0) mode = 'realtime';
    },
    ingestLive(updates) {
      realtime.ingestLive(updates);
      if (mode === 'simulation' && realtime.latestLiveT() > 0) mode = 'realtime';
    },
    ingestHistory(msg) {
      realtime.ingestHistory(msg);
    },
    setPlayhead(serverT) {
      if (serverT === null) {
        playheadServerT = null;
      } else {
        const live = realtime.liveRenderT();
        const start = realtime.raceStartT();
        // Clamp to [raceStart, live].
        const clamped = Math.min(live, start > 0 ? Math.max(start, serverT) : serverT);
        playheadServerT = clamped;
      }
      emitPlayheadIfChanged();
    },
    getPlayheadInfo,
    onPlayhead(fn) {
      playheadListeners.add(fn);
      // Fire once immediately so subscribers get current state.
      fn(getPlayheadInfo());
      return () => { playheadListeners.delete(fn); };
    },
    getMode: () => mode,
    destroy() {
      running = false;
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      detachInput();
    },
  };
}
