export interface WorldPoint {
  x: number;
  y: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface TileFallback {
  img: HTMLImageElement;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface Buoy {
  id: string;
  number: number;
  lat: number;
  lon: number;
}

export interface FinishLine {
  p1: GeoPoint | null;
  p2: GeoPoint | null;
}

export interface Route {
  id: string;
  color: string;
  points: GeoPoint[];
}

export const ROUTE_COLORS: { id: string; hex: string; label: string }[] = [
  { id: 'cyan', hex: '#00ccff', label: 'Azul' },
  { id: 'lime', hex: '#66ff33', label: 'Verde' },
  { id: 'magenta', hex: '#ff44cc', label: 'Rosa' },
  { id: 'orange', hex: '#ff8800', label: 'Laranja' },
  { id: 'yellow', hex: '#ffdd00', label: 'Amarelo' },
];

export type BoatType = 'mono' | 'cat' | 'arrow' | 'jetski' | 'support';

export interface Boat {
  capturedAt?: string;
  speedKnown?: boolean;
  activity: 'racing' | 'waiting' | 'support';
  raceRouteId: string | null;
  id: string;
  label: string;
  type: BoatType;
  /** Outboard motors (1–3): drawn on the hull and as separate wake streams. */
  motors?: number;
  /** Team logo URL, when the team has one. */
  logo?: string;
  hullColor: string;
  accentColor: string;
  lat: number;
  lon: number;
  heading: number;
  headingTarget: number;
  speed: number;
  baseSpeed: number;
  speedPhaseOffset: number;
  routeIndex: number;
  routeT: number;
  trail: [number, number][];
}

export type EditTool = 'buoy' | 'finish' | 'maintenance' | 'waiting' | 'route' | null;

export interface MapState {
  demo?: boolean;
  venueId?: string;
  style: 'chart' | 'satellite';
  paused: boolean;
  reducedMotion: boolean;
  animationTime: number;
  // Viewport
  width: number;
  height: number;
  dpr: number;
  zoom: number;
  worldCX: number;
  worldCY: number;
  /** 3D camera heading in degrees clockwise from north (0 = north up). */
  bearing: number;
  /** 3D camera pitch in degrees above the horizon; null follows the automatic view. */
  pitch: number | null;

  // Interaction
  dragging: boolean;
  dragX: number;
  dragY: number;
  dragStartX: number;
  dragStartY: number;
  followBoatId: string | null;

  // Tile rendering — the zoom level currently being drawn (changes only when new tiles are ready)
  activeZi: number;

  // Boats
  boats: Boat[];

  // Buoys & circuit
  courseId: string;
  buoys: Buoy[];
  finishLine: FinishLine;
  maintenanceArea: GeoPoint[];
  waitingArea: GeoPoint[];
  routes: Route[];
  activeRouteId: string | null;
  editTool: EditTool;
}

export interface MapConfig {
  tileSize: number;
  zoomMin: number;
  zoomMax: number;
  startLat: number;
  startLon: number;
  tileUrl: string;
  maxTrailLength: number;
  maxCachedTiles: number;
}

export const DEFAULT_CONFIG: MapConfig = {
  tileSize: 256,
  zoomMin: 14,
  zoomMax: 21,
  startLat: -22.414654,
  startLon: -41.818751,
  tileUrl:
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile',
  maxTrailLength: 100,
  maxCachedTiles: 96,
};
