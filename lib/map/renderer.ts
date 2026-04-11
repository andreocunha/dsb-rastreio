import type { MapState, MapConfig, ScreenPoint, GeoPoint, Boat } from './types';
import { geoToScreen, createFrameProjection, projectGeo, type FrameProjection } from './geo';
import { TileCache } from './tiles';

/** Draw a single frame of the map */
export function renderFrame(
  ctx: CanvasRenderingContext2D,
  state: MapState,
  config: MapConfig,
  tiles: TileCache,
): void {
  const { width: W, height: H, zoom, worldCX, worldCY } = state;
  const TS = config.tileSize;

  ctx.fillStyle = '#0c1225';
  ctx.fillRect(0, 0, W, H);

  // --- Tiles (stable zoom: only switch tile set when new level is loaded) ---
  const targetZi = Math.max(config.zoomMin, Math.min(config.zoomMax, Math.round(zoom)));
  renderTiles(ctx, state, config, tiles, W, H, TS, zoom, worldCX, worldCY, targetZi);

  // --- Trails (all boats, using pre-computed projection) ---
  const fp = createFrameProjection(
    worldCX, worldCY, zoom, TS, W, H,
  );
  for (const boat of state.boats) {
    drawTrail(ctx, fp, boat);
  }

  // --- Maintenance area ---
  drawMaintenanceArea(ctx, state, config);

  // --- Routes ---
  drawRoutes(ctx, state, config);

  // --- Finish line ---
  drawFinishLine(ctx, state, config);

  // --- Buoys ---
  drawBuoys(ctx, state, config);

  // --- Boats ---
  for (const boat of state.boats) {
    drawBoat(ctx, state, config, boat, boat.id === state.followBoatId);
  }
}

/** Compute tile grid bounds for a given zoom level */
function tileGrid(
  zi: number, zoom: number, ts: number,
  worldCX: number, worldCY: number, W: number, H: number,
) {
  const frac = Math.pow(2, zoom - zi);
  const tds = ts * frac;
  const mx = 1 << zi;
  const tcx = worldCX * mx;
  const tcy = worldCY * mx;
  const hw = W / 2 / tds;
  const hh = H / 2 / tds;
  return {
    frac, tds, mx, tcx, tcy,
    x0: Math.floor(tcx - hw) - 1,
    x1: Math.ceil(tcx + hw) + 1,
    y0: Math.floor(tcy - hh) - 1,
    y1: Math.ceil(tcy + hh) + 1,
  };
}

/** Draw tiles from state.activeZi. Only switch to targetZi when its tiles are ready. */
function renderTiles(
  ctx: CanvasRenderingContext2D,
  state: MapState,
  config: MapConfig,
  tiles: TileCache,
  W: number, H: number, TS: number,
  zoom: number, worldCX: number, worldCY: number,
  targetZi: number,
): void {
  // Clamp activeZi to valid range
  if (state.activeZi < config.zoomMin) state.activeZi = config.zoomMin;
  if (state.activeZi > config.zoomMax) state.activeZi = config.zoomMax;

  // If target changed, check if we can switch
  if (targetZi !== state.activeZi) {
    const tg = tileGrid(targetZi, zoom, TS, worldCX, worldCY, W, H);
    const { loaded, total } = tiles.countLoaded(targetZi, tg.x0, tg.x1, tg.y0, tg.y1);

    // Start loading target tiles
    const tmx = 1 << targetZi;
    for (let tx = tg.x0; tx <= tg.x1; tx++) {
      for (let ty = tg.y0; ty <= tg.y1; ty++) {
        if (ty < 0 || ty >= tmx) continue;
        const wx = ((tx % tmx) + tmx) % tmx;
        tiles.load(`${targetZi}/${wx}/${ty}`, targetZi, wx, ty);
      }
    }

    // Switch when 70%+ loaded
    if (total > 0 && loaded / total >= 0.7) {
      state.activeZi = targetZi;
    }
  }

  // Render from activeZi (always consistent — no mixed zoom levels)
  const g = tileGrid(state.activeZi, zoom, TS, worldCX, worldCY, W, H);

  for (let tx = g.x0; tx <= g.x1; tx++) {
    for (let ty = g.y0; ty <= g.y1; ty++) {
      if (ty < 0 || ty >= g.mx) continue;
      const wx = ((tx % g.mx) + g.mx) % g.mx;
      const k = `${state.activeZi}/${wx}/${ty}`;
      const sx = (tx - g.tcx) * g.tds + W / 2;
      const sy = (ty - g.tcy) * g.tds + H / 2;
      const ds = Math.ceil(g.tds) + 1;

      const cached = tiles.get(k);
      if (cached) {
        ctx.drawImage(cached, sx, sy, ds, ds);
      } else {
        // Fallback from any other cached zoom
        const fb = tiles.findFallback(state.activeZi, wx, ty);
        if (fb) {
          ctx.drawImage(fb.img, fb.sx, fb.sy, fb.sw, fb.sh, sx, sy, ds, ds);
        }
        tiles.load(k, state.activeZi, wx, ty);
      }
    }
  }
}

const MIN_TRAIL_SEG_PX = 2;

function drawTrail(
  ctx: CanvasRenderingContext2D,
  fp: FrameProjection,
  boat: Boat,
): void {
  const trail = boat.trail;
  if (trail.length < 2) return;

  const len = trail.length;
  const BATCHES = 10;
  const batchSize = Math.ceil(len / BATCHES);
  const rgb = hexToRgbTuple(boat.accentColor);
  const minDistSq = MIN_TRAIL_SEG_PX * MIN_TRAIL_SEG_PX;

  for (let b = 0; b < BATCHES; b++) {
    const start = Math.max(1, b * batchSize);
    const end = Math.min(len, (b + 1) * batchSize);
    if (start >= end) continue;

    const mid = (start + end) / 2 / len;
    const alpha = mid * mid * 0.5;
    if (alpha < 0.005) continue;

    ctx.beginPath();
    let prev = projectGeo(trail[start - 1][0], trail[start - 1][1], fp);
    for (let i = start; i < end; i++) {
      const cur = projectGeo(trail[i][0], trail[i][1], fp);
      // Skip segments shorter than 2px — invisible anyway
      const dx = cur.x - prev.x;
      const dy = cur.y - prev.y;
      if (dx * dx + dy * dy >= minDistSq || i === end - 1) {
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(cur.x, cur.y);
        prev = cur;
      }
    }
    ctx.strokeStyle = `rgba(${rgb},${alpha})`;
    ctx.lineWidth = 1 + mid * 1.5;
    ctx.stroke();
  }
}

function drawBoat(
  ctx: CanvasRenderingContext2D,
  state: MapState,
  config: MapConfig,
  boat: Boat,
  isFollowed: boolean,
): void {
  const bp = geoToScreen(
    boat.lat, boat.lon,
    state.worldCX, state.worldCY,
    state.zoom, config.tileSize,
    state.width, state.height,
  );

  ctx.save();
  ctx.translate(bp.x, bp.y);
  ctx.rotate((boat.heading * Math.PI) / 180);

  drawWake(ctx, boat.speed);

  if (isFollowed) {
    ctx.beginPath();
    ctx.arc(0, 0, 22, 0, Math.PI * 2);
    ctx.strokeStyle = boat.accentColor;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Glow
  ctx.beginPath();
  ctx.ellipse(0, 1, 10, 14, 0, 0, Math.PI * 2);
  ctx.fillStyle = hexToRgba(boat.accentColor, 0.12);
  ctx.fill();

  switch (boat.type) {
    case 'cat':     drawCatamaran(ctx, boat); break;
    case 'mono':    drawMonohull(ctx, boat); break;
    case 'jetski':  drawJetSki(ctx, boat); break;
    case 'support': drawSupportBoat(ctx, boat); break;
    case 'arrow':   drawArrow(ctx, boat); break;
  }

  ctx.restore();
}

function drawMonohull(ctx: CanvasRenderingContext2D, boat: Boat): void {
  // Hull — elongated pointed shape
  ctx.beginPath();
  ctx.moveTo(0, -14);
  ctx.bezierCurveTo(5, -6, 6, 6, 4, 13);
  ctx.quadraticCurveTo(0, 16, -4, 13);
  ctx.bezierCurveTo(-6, 6, -5, -6, 0, -14);
  ctx.fillStyle = boat.hullColor;
  ctx.strokeStyle = boat.accentColor;
  ctx.lineWidth = 1;
  ctx.fill();
  ctx.stroke();

  // Solar panel on top
  drawSolarPanel(ctx, -4, -8, 8, 14);
}

function drawCatamaran(ctx: CanvasRenderingContext2D, boat: Boat): void {
  const hullW = 2.5;
  const hullGap = 5;

  // Left hull
  ctx.beginPath();
  ctx.moveTo(-hullGap, -13);
  ctx.bezierCurveTo(-hullGap + hullW, -6, -hullGap + hullW, 6, -hullGap + 1, 13);
  ctx.quadraticCurveTo(-hullGap, 15, -hullGap - 1, 13);
  ctx.bezierCurveTo(-hullGap - hullW, 6, -hullGap - hullW, -6, -hullGap, -13);
  ctx.fillStyle = boat.hullColor;
  ctx.strokeStyle = boat.accentColor;
  ctx.lineWidth = 0.8;
  ctx.fill();
  ctx.stroke();

  // Right hull
  ctx.beginPath();
  ctx.moveTo(hullGap, -13);
  ctx.bezierCurveTo(hullGap + hullW, -6, hullGap + hullW, 6, hullGap + 1, 13);
  ctx.quadraticCurveTo(hullGap, 15, hullGap - 1, 13);
  ctx.bezierCurveTo(hullGap - hullW, 6, hullGap - hullW, -6, hullGap, -13);
  ctx.fillStyle = boat.hullColor;
  ctx.strokeStyle = boat.accentColor;
  ctx.lineWidth = 0.8;
  ctx.fill();
  ctx.stroke();

  // Cross beams
  ctx.beginPath();
  ctx.moveTo(-hullGap, -4);
  ctx.lineTo(hullGap, -4);
  ctx.moveTo(-hullGap, 5);
  ctx.lineTo(hullGap, 5);
  ctx.strokeStyle = '#bbb';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Solar panel spanning across both hulls
  drawSolarPanel(ctx, -hullGap - 1, -8, (hullGap + 1) * 2, 14);
}

/** Draw a solar panel rectangle with grid lines */
function drawSolarPanel(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
): void {
  // Panel background
  ctx.fillStyle = '#1a3a5c';
  ctx.fillRect(x, y, w, h);

  // Panel border
  ctx.strokeStyle = '#4a7aaa';
  ctx.lineWidth = 0.5;
  ctx.strokeRect(x, y, w, h);

  // Grid lines (solar cells)
  ctx.beginPath();
  const cols = 2;
  const rows = 4;
  for (let c = 1; c < cols; c++) {
    const lx = x + (w / cols) * c;
    ctx.moveTo(lx, y);
    ctx.lineTo(lx, y + h);
  }
  for (let r = 1; r < rows; r++) {
    const ly = y + (h / rows) * r;
    ctx.moveTo(x, ly);
    ctx.lineTo(x + w, ly);
  }
  ctx.strokeStyle = 'rgba(100,160,210,0.4)';
  ctx.lineWidth = 0.4;
  ctx.stroke();

  // Subtle reflection highlight
  ctx.fillStyle = 'rgba(150,200,255,0.08)';
  ctx.fillRect(x + 1, y + 1, w * 0.4, h * 0.3);
}

function drawArrow(ctx: CanvasRenderingContext2D, boat: Boat): void {
  // Original boat shape — pointed hull with curves
  ctx.beginPath();
  ctx.moveTo(0, -16);
  ctx.bezierCurveTo(6, -4, 8, 8, 5, 14);
  ctx.quadraticCurveTo(0, 18, -5, 14);
  ctx.bezierCurveTo(-8, 8, -6, -4, 0, -16);
  ctx.fillStyle = boat.hullColor;
  ctx.strokeStyle = boat.accentColor;
  ctx.lineWidth = 1.2;
  ctx.fill();
  ctx.stroke();

  // Center dot
  ctx.beginPath();
  ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = boat.accentColor;
  ctx.fill();
}

function drawJetSki(ctx: CanvasRenderingContext2D, boat: Boat): void {
  // Compact body
  ctx.beginPath();
  ctx.moveTo(0, -10);
  ctx.bezierCurveTo(4, -6, 5, 2, 4, 8);
  ctx.quadraticCurveTo(0, 11, -4, 8);
  ctx.bezierCurveTo(-5, 2, -4, -6, 0, -10);
  ctx.fillStyle = boat.hullColor;
  ctx.strokeStyle = boat.accentColor;
  ctx.lineWidth = 1;
  ctx.fill();
  ctx.stroke();

  // Seat
  ctx.fillStyle = '#333';
  ctx.fillRect(-2, -2, 4, 5);

  // Handlebar
  ctx.beginPath();
  ctx.moveTo(-3, -4);
  ctx.lineTo(0, -6);
  ctx.lineTo(3, -4);
  ctx.strokeStyle = '#666';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Rescue cross
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, 3);
  ctx.lineTo(0, 7);
  ctx.moveTo(-2, 5);
  ctx.lineTo(2, 5);
  ctx.stroke();
}

function drawSupportBoat(ctx: CanvasRenderingContext2D, boat: Boat): void {
  // Wider hull — motorboat shape
  ctx.beginPath();
  ctx.moveTo(0, -14);
  ctx.bezierCurveTo(7, -6, 8, 4, 6, 12);
  ctx.quadraticCurveTo(0, 16, -6, 12);
  ctx.bezierCurveTo(-8, 4, -7, -6, 0, -14);
  ctx.fillStyle = boat.hullColor;
  ctx.strokeStyle = boat.accentColor;
  ctx.lineWidth = 1.2;
  ctx.fill();
  ctx.stroke();

  // Cabin
  ctx.beginPath();
  ctx.roundRect(-4, -6, 8, 8, 2);
  ctx.fillStyle = hexToRgba(boat.accentColor, 0.3);
  ctx.fill();
  ctx.strokeStyle = boat.accentColor;
  ctx.lineWidth = 0.6;
  ctx.stroke();

  // Accent stripe
  ctx.beginPath();
  ctx.moveTo(-6, 4);
  ctx.lineTo(6, 4);
  ctx.strokeStyle = boat.accentColor;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

/** Draw an organic wake behind the boat, scaled by speed */
function drawWake(ctx: CanvasRenderingContext2D, speed: number): void {
  const intensity = Math.max(0, Math.min(1, (speed - 2) / 10));
  if (intensity < 0.01) return;

  const now = Date.now();
  const wakeLen = 25 + intensity * 45;
  const spread = 4 + intensity * 10;

  // Tapered foam shape — filled, fades out with gradient
  const grad = ctx.createLinearGradient(0, 14, 0, 14 + wakeLen);
  grad.addColorStop(0, `rgba(255,255,255,${0.25 + intensity * 0.2})`);
  grad.addColorStop(0.4, `rgba(200,230,255,${0.12 + intensity * 0.1})`);
  grad.addColorStop(1, 'rgba(200,230,255,0)');

  ctx.beginPath();
  ctx.moveTo(0, 14);
  ctx.quadraticCurveTo(spread * 0.3, 14 + wakeLen * 0.3, spread, 14 + wakeLen);
  ctx.lineTo(-spread, 14 + wakeLen);
  ctx.quadraticCurveTo(-spread * 0.3, 14 + wakeLen * 0.3, 0, 14);
  ctx.fillStyle = grad;
  ctx.fill();

  // Animated ripple arcs drifting away from stern
  for (let i = 0; i < 3; i++) {
    const phase = (now / 1200 + i / 3) % 1;
    const y = 18 + phase * wakeLen * 0.7;
    const rx = 2 + phase * spread * 0.5;
    const a = (0.3 + intensity * 0.25) * (1 - phase);
    if (a < 0.02) continue;

    ctx.beginPath();
    ctx.ellipse(0, y, rx, rx * 0.2, 0, 0.3, Math.PI - 0.3);
    ctx.strokeStyle = `rgba(220,240,255,${a})`;
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  // Small bubbles near stern at higher speeds
  if (intensity > 0.35) {
    const ba = (intensity - 0.35) * 0.6;
    for (let i = 0; i < 4; i++) {
      const seed = now * 0.005 + i * 2.3;
      const bx = Math.sin(seed) * spread * 0.4;
      const by = 16 + (Math.abs(Math.cos(seed * 1.1)) * 10);
      ctx.beginPath();
      ctx.arc(bx, by, 0.7 + Math.sin(seed * 0.6) * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(230,245,255,${ba})`;
      ctx.fill();
    }
  }
}

function drawBuoys(
  ctx: CanvasRenderingContext2D,
  state: MapState,
  config: MapConfig,
): void {
  const now = Date.now();

  for (let i = 0; i < state.buoys.length; i++) {
    const b = state.buoys[i];
    const p = geoToScreen(
      b.lat, b.lon,
      state.worldCX, state.worldCY,
      state.zoom, config.tileSize,
      state.width, state.height,
    );

    ctx.save();
    ctx.translate(p.x, p.y);

    // Subtle bobbing animation
    const bob = Math.sin(now * 0.002 + i * 1.7) * 1.5;

    // Water ring
    ctx.beginPath();
    ctx.ellipse(0, 6 + bob * 0.3, 10, 3, 0, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,140,0,0.2)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Pole
    ctx.beginPath();
    ctx.moveTo(0, bob);
    ctx.lineTo(0, -18 + bob);
    ctx.strokeStyle = '#ddd';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Base float (orange sphere)
    ctx.beginPath();
    ctx.arc(0, bob, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#ff6600';
    ctx.fill();
    ctx.strokeStyle = '#cc4400';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Highlight on float
    ctx.beginPath();
    ctx.arc(-1.5, -1.5 + bob, 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,220,160,0.5)';
    ctx.fill();

    // Flag
    ctx.beginPath();
    ctx.moveTo(0, -18 + bob);
    ctx.lineTo(8, -15 + bob);
    ctx.lineTo(0, -12 + bob);
    ctx.closePath();
    ctx.fillStyle = '#ff3300';
    ctx.fill();

    // Label
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 2.5;
    const label = `${b.number}`;
    ctx.strokeText(label, 0, -22 + bob);
    ctx.fillText(label, 0, -22 + bob);

    ctx.restore();
  }
}

// --- Helper to convert GeoPoint to screen ---
function gp2s(p: GeoPoint, config: MapConfig, state: MapState): ScreenPoint {
  return geoToScreen(
    p.lat, p.lon,
    state.worldCX, state.worldCY,
    state.zoom, config.tileSize,
    state.width, state.height,
  );
}

// ─── Routes ─────────────────────────────────────────────────────

function drawRoutes(
  ctx: CanvasRenderingContext2D,
  state: MapState,
  config: MapConfig,
): void {
  for (const route of state.routes) {
    if (route.points.length < 2) {
      // Draw single placed point
      if (route.points.length === 1) {
        const p = gp2s(route.points[0], config, state);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = route.color;
        ctx.fill();
      }
      continue;
    }

    const pts = route.points.map((p) => gp2s(p, config, state));

    // Glow
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.strokeStyle = hexToRgba(route.color, 0.1);
    ctx.lineWidth = 8;
    ctx.stroke();

    // Dashed path
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.setLineDash([12, 8]);
    ctx.strokeStyle = hexToRgba(route.color, 0.55);
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Direction arrows
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const angle = Math.atan2(b.y - a.y, b.x - a.x);

      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(6, 0);
      ctx.lineTo(-4, -4);
      ctx.lineTo(-4, 4);
      ctx.closePath();
      ctx.fillStyle = hexToRgba(route.color, 0.7);
      ctx.fill();
      ctx.restore();
    }
  }
}

/** Convert #rrggbb to "r,g,b" string (for reuse in rgba) */
function hexToRgbTuple(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r},${g},${b}`;
}

/** Convert #rrggbb to rgba string */
function hexToRgba(hex: string, alpha: number): string {
  return `rgba(${hexToRgbTuple(hex)},${alpha})`;
}

// ─── Finish line ─────────────────────────────────────────────────

function drawFinishLine(
  ctx: CanvasRenderingContext2D,
  state: MapState,
  config: MapConfig,
): void {
  const fl = state.finishLine;

  // Draw placed point(s) as markers when only p1 exists
  if (fl.p1 && !fl.p2) {
    const p = gp2s(fl.p1, config, state);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();
    return;
  }

  if (!fl.p1 || !fl.p2) return;

  const a = gp2s(fl.p1, config, state);
  const b = gp2s(fl.p2, config, state);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;

  const angle = Math.atan2(dy, dx);
  // Normal perpendicular — the "width" of the finish band
  const nx = -dy / len;
  const ny = dx / len;
  const halfW = 6; // px half-width of the checkered band

  ctx.save();

  // Checkered pattern
  const squares = Math.max(4, Math.round(len / 8));
  const segLen = len / squares;

  for (let i = 0; i < squares; i++) {
    const t = i / squares;
    const cx = a.x + dx * t;
    const cy = a.y + dy * t;

    // Alternate colors in a 2-row checkerboard
    for (let row = 0; row < 2; row++) {
      const isWhite = (i + row) % 2 === 0;
      const offN = (row === 0 ? -1 : 0) * halfW;

      // Corners of this checker cell
      const x0 = cx + nx * offN;
      const y0 = cy + ny * offN;

      ctx.save();
      ctx.translate(x0, y0);
      ctx.rotate(angle);

      ctx.fillStyle = isWhite ? '#fff' : '#222';
      ctx.fillRect(0, 0, segLen + 0.5, halfW);
      ctx.restore();
    }
  }

  // Border
  const corners = [
    { x: a.x - nx * halfW, y: a.y - ny * halfW },
    { x: b.x - nx * halfW, y: b.y - ny * halfW },
    { x: b.x + nx * halfW, y: b.y + ny * halfW },
    { x: a.x + nx * halfW, y: a.y + ny * halfW },
  ];
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
  ctx.closePath();
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // "CHEGADA" label — rotated to follow the line
  const midX = (a.x + b.x) / 2;
  const midY = (a.y + b.y) / 2;
  // Keep text readable: flip if it would be upside down
  let textAngle = angle;
  if (textAngle > Math.PI / 2) textAngle -= Math.PI;
  if (textAngle < -Math.PI / 2) textAngle += Math.PI;

  ctx.save();
  ctx.translate(midX, midY);
  ctx.rotate(textAngle);
  ctx.font = 'bold 9px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = 2.5;
  ctx.strokeText('CHEGADA', 0, -halfW - 4);
  ctx.fillText('CHEGADA', 0, -halfW - 4);
  ctx.restore();

  ctx.restore();
}

// ─── Maintenance area ────────────────────────────────────────────

function drawMaintenanceArea(
  ctx: CanvasRenderingContext2D,
  state: MapState,
  config: MapConfig,
): void {
  const area = state.maintenanceArea;
  if (area.length === 0) return;

  const pts = area.map((p) => gp2s(p, config, state));

  // Draw placed points as markers when area is incomplete
  if (pts.length < 3) {
    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#f0c040';
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 1.5;
      ctx.fill();
      ctx.stroke();
    }
    // Draw connecting line for 2 points
    if (pts.length === 2) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      ctx.lineTo(pts[1].x, pts[1].y);
      ctx.strokeStyle = 'rgba(240,192,64,0.4)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    return;
  }

  // Filled polygon
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i].x, pts[i].y);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(240,192,64,0.18)';
  ctx.fill();

  // Dashed border
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = 'rgba(240,192,64,0.7)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.setLineDash([]);

  // Diagonal hatch lines for visual clarity
  const minX = Math.min(...pts.map((p) => p.x));
  const maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const maxY = Math.max(...pts.map((p) => p.y));

  ctx.clip(); // Clip hatch to polygon
  ctx.beginPath();
  const step = 14;
  for (let d = minX + minY - step; d < maxX + maxY + step; d += step) {
    ctx.moveTo(d - maxY, maxY);
    ctx.lineTo(d - minY, minY);
  }
  ctx.strokeStyle = 'rgba(240,192,64,0.12)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.restore();

  // Corner dots
  for (const p of pts) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#f0c040';
    ctx.fill();
  }

  // Label at centroid
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  ctx.font = 'bold 9px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f0c040';
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = 2.5;
  ctx.strokeText('MANUTENÇÃO', cx, cy);
  ctx.fillText('MANUTENÇÃO', cx, cy);
}
