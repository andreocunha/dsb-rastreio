// Realtime simulation server for DSB Rastreio.
// Broadcasts boat positions at ~1Hz over WebSocket. Optionally injects GPS
// noise, outliers, and interval jitter so the client interpolation/outlier
// rejection logic can be exercised end-to-end.
//
// Run: node server/sim-server.mjs
// Env knobs:
//   PORT             default 4001
//   BROADCAST_MS     default 1000   nominal interval between broadcasts
//   INTERVAL_JITTER  default 0      0..1; max extra random delay as fraction
//   NOISE_M          default 1.5    stddev of GPS noise in meters
//   OUTLIER_PROB     default 0      0..1; probability per message of an outlier
//   OUTLIER_M        default 200    distance of injected outlier in meters
//   DROP_PROB        default 0      0..1; probability of dropping a broadcast

import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT ?? 4001);
const BROADCAST_MS = Number(process.env.BROADCAST_MS ?? 1000);
const INTERVAL_JITTER = Number(process.env.INTERVAL_JITTER ?? 0);
const NOISE_M = Number(process.env.NOISE_M ?? 1.5);
const OUTLIER_PROB = Number(process.env.OUTLIER_PROB ?? 0);
const OUTLIER_M = Number(process.env.OUTLIER_M ?? 200);
const DROP_PROB = Number(process.env.DROP_PROB ?? 0);

const DEMO_ROUTE = [
  [-22.414654, -41.818751], [-22.414, -41.8172], [-22.4132, -41.8158],
  [-22.4122, -41.8148], [-22.411, -41.8144], [-22.4098, -41.8148],
  [-22.4088, -41.8158], [-22.4082, -41.8172], [-22.408, -41.819],
  [-22.4084, -41.8208], [-22.4094, -41.8222], [-22.4106, -41.823],
  [-22.412, -41.8226], [-22.4132, -41.8216], [-22.4142, -41.82],
  [-22.414654, -41.818751],
];

// Realistic solar-boat race profile:
//   - Race boats: 3–7 knots typical, ~5 kn average (max recorded 13 kn).
//   - Support boat: ~9 kn.
//   - Jetski rescue: 15–22 kn.
const BOAT_DEFS = [
  { id: 'b1', avgKn: 5.5, varKn: 1.5, startOffset: 0 },
  { id: 'b2', avgKn: 4.8, varKn: 1.2, startOffset: 0.06 },
  { id: 'b3', avgKn: 6.0, varKn: 2.0, startOffset: 0.12 },
  { id: 'b4', avgKn: 4.2, varKn: 1.4, startOffset: 0.18 },
  { id: 'b5', avgKn: 5.0, varKn: 1.6, startOffset: 0.24 },
  { id: 'b6', avgKn: 5.3, varKn: 1.3, startOffset: 0.30 },
  { id: 's1', avgKn: 17.0, varKn: 3.0, startOffset: 0.40 },
  { id: 's2', avgKn: 9.0,  varKn: 2.0, startOffset: 0.55 },
  { id: 's3', avgKn: 18.5, varKn: 3.5, startOffset: 0.70 },
];

const KN_TO_MPS = 0.514444;
const TICK_MS = 50;

function segDistMeters(a, b) {
  const meanLat = ((a[0] + b[0]) / 2) * (Math.PI / 180);
  const dLat = (b[0] - a[0]) * (Math.PI / 180);
  const dLon = (b[1] - a[1]) * (Math.PI / 180) * Math.cos(meanLat);
  return Math.hypot(dLat, dLon) * 6371000;
}

const SEGMENT_LENGTHS = DEMO_ROUTE.map((p, i) =>
  segDistMeters(p, DEMO_ROUTE[(i + 1) % DEMO_ROUTE.length]),
);

function makeBoat(def, i) {
  const t = def.startOffset;
  const idx = Math.floor(t * DEMO_ROUTE.length) % DEMO_ROUTE.length;
  const local = (t * DEMO_ROUTE.length) % 1;
  return {
    id: def.id,
    avgKn: def.avgKn,
    varKn: def.varKn,
    routeIndex: idx,
    routeT: local,
    phase: i * 1.3,
  };
}

const boats = BOAT_DEFS.map(makeBoat);

// routeT advances proportionally to actual m/s so the client-derived speed in
// the HUD matches the configured knots regardless of segment length.
// `dtMs` is the real elapsed time — never assume the timer fires exactly on TICK_MS.
function step(boat, now, dtMs) {
  const knots = boat.avgKn + Math.sin(now / 3000 + boat.phase) * boat.varKn;
  const mps = Math.max(0, knots) * KN_TO_MPS;
  const segLen = SEGMENT_LENGTHS[boat.routeIndex % SEGMENT_LENGTHS.length];
  if (segLen <= 0) return;
  boat.routeT += (mps * (dtMs / 1000)) / segLen;
  while (boat.routeT >= 1) {
    boat.routeT -= 1;
    boat.routeIndex = (boat.routeIndex + 1) % DEMO_ROUTE.length;
  }
}

function currentPosition(boat) {
  const from = DEMO_ROUTE[boat.routeIndex % DEMO_ROUTE.length];
  const to = DEMO_ROUTE[(boat.routeIndex + 1) % DEMO_ROUTE.length];
  return {
    lat: from[0] + (to[0] - from[0]) * boat.routeT,
    lon: from[1] + (to[1] - from[1]) * boat.routeT,
  };
}

// Convert a meters offset to degrees lat/lon at a given latitude.
function metersToDeg(meters, lat) {
  const dLat = meters / 111111;
  const dLon = meters / (111111 * Math.cos((lat * Math.PI) / 180));
  return { dLat, dLon };
}

// Gaussian sample (Box–Muller).
function gauss() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function applyNoise(pos, sigmaM) {
  if (sigmaM <= 0) return pos;
  const { dLat, dLon } = metersToDeg(sigmaM, pos.lat);
  return {
    lat: pos.lat + gauss() * dLat,
    lon: pos.lon + gauss() * dLon,
  };
}

function applyOutlier(pos, distM) {
  const angle = Math.random() * 2 * Math.PI;
  const { dLat, dLon } = metersToDeg(distM, pos.lat);
  return {
    lat: pos.lat + Math.sin(angle) * dLat,
    lon: pos.lon + Math.cos(angle) * dLon,
  };
}

// Per-boat full history, sorted ascending by t. Append-only.
//   In a real deployment this would be persisted (e.g., Postgres); the
//   simulator keeps it in process memory so seeking works during a session.
const history = new Map(); // boatId → Array<{t, lat, lon}>
for (const def of BOAT_DEFS) history.set(def.id, []);
let raceStartT = 0; // ms; 0 = race hasn't started

function pushHistory(update) {
  history.get(update.id).push({ t: update.t, lat: update.lat, lon: update.lon });
}

// Binary-search a sample's first index with t >= target.
function lowerBound(arr, t) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid].t < t) lo = mid + 1; else hi = mid;
  }
  return lo;
}

function historySlice(boatId, fromT, toT) {
  const arr = history.get(boatId);
  if (!arr) return [];
  const start = lowerBound(arr, fromT);
  const end = lowerBound(arr, toT + 1);
  const out = new Array(end - start);
  for (let i = start; i < end; i++) out[i - start] = { id: boatId, ...arr[i] };
  return out;
}

const wss = new WebSocketServer({ port: PORT });
const clients = new Set();
// Send the most recent ~30s on connect so the live smoother has enough data.
const INIT_TAIL_MS = 30_000;

function sendInit(ws) {
  const now = Date.now();
  const tail = [];
  for (const id of history.keys()) {
    for (const s of historySlice(id, now - INIT_TAIL_MS, now)) tail.push(s);
  }
  ws.send(JSON.stringify({ type: 'init', raceStartT, serverT: now, tail }));
}

function handleGetHistory(ws, msg) {
  if (!Number.isFinite(msg.from) || !Number.isFinite(msg.to)) return;
  const samples = [];
  for (const id of history.keys()) {
    for (const s of historySlice(id, msg.from, msg.to)) samples.push(s);
  }
  ws.send(JSON.stringify({
    type: 'history',
    reqId: msg.reqId ?? null,
    from: msg.from,
    to: msg.to,
    samples,
  }));
}

wss.on('connection', (ws) => {
  clients.add(ws);
  sendInit(ws);
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg && msg.type === 'getHistory') handleGetHistory(ws, msg);
  });
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
});

// Internal physics loop
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dtMs = now - lastTick;
  lastTick = now;
  for (const b of boats) step(b, now, dtMs);
}, TICK_MS);

// Broadcast loop — variable cadence to simulate flaky network.
function scheduleBroadcast() {
  const jitter = INTERVAL_JITTER > 0 ? Math.random() * INTERVAL_JITTER : 0;
  const delay = BROADCAST_MS * (1 + jitter);
  setTimeout(broadcast, delay);
}

function broadcast() {
  scheduleBroadcast();
  const t = Date.now();
  if (raceStartT === 0) raceStartT = t;
  // Record samples to history every tick, regardless of drop simulation — we
  // simulate network loss, not GPS loss. The boats kept telemetering, the
  // client just didn't receive it.
  const samples = boats.map((b) => {
    const pos = currentPosition(b);
    let noisy = applyNoise(pos, NOISE_M);
    if (OUTLIER_PROB > 0 && Math.random() < OUTLIER_PROB) {
      noisy = applyOutlier(noisy, OUTLIER_M);
    }
    return { id: b.id, lat: noisy.lat, lon: noisy.lon, t };
  });
  for (const s of samples) pushHistory(s);
  if (DROP_PROB > 0 && Math.random() < DROP_PROB) return;
  const msg = JSON.stringify({ type: 'positions', updates: samples });
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}

scheduleBroadcast();

console.log(`[sim] WebSocket ready on ws://localhost:${PORT}`);
console.log(`[sim] cadence=${BROADCAST_MS}ms jitter=${INTERVAL_JITTER} noise=${NOISE_M}m outlier=${OUTLIER_PROB}@${OUTLIER_M}m drop=${DROP_PROB}`);
