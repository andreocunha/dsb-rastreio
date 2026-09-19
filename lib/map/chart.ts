import geography from './data/imboassica.json';
import { geoToWorld, worldScale } from './geo';
import type { MapConfig, MapState } from './types';

const ORIGIN = geoToWorld(-22.411, -41.823);
const SCALE = 2 ** 16 * 256;
const xy = ([lon, lat]: number[]) => {
  const p = geoToWorld(lat, lon);
  return { x: (p.x - ORIGIN.x) * SCALE, y: (p.y - ORIGIN.y) * SCALE };
};
const makePath = (points: number[][], close = false) => {
  const path = new Path2D();
  points.forEach((point, i) => {
    const p = xy(point);
    if (i === 0) path.moveTo(p.x, p.y); else path.lineTo(p.x, p.y);
  });
  if (close) path.closePath();
  return path;
};
let shapes: { path: Path2D; kind: string; major: boolean }[] | undefined;
let sea: Path2D;
let coast: Path2D;
let lake: Path2D;

function prepare() {
  if (shapes) return;
  shapes = geography.features.filter(f => f.kind !== 'coastline').map(f => ({
    kind: f.kind, major: f.major, path: makePath(f.points, f.kind !== 'road'),
  }));
  const coastPoints = geography.features.filter(f => f.kind === 'coastline')
    .sort((a, b) => a.points[0][0] - b.points[0][0]).flatMap(f => f.points);
  coast = makePath(coastPoints);
  sea = makePath([...coastPoints, [-41.7, -22.35], [-41.7, -22.55], [-41.95, -22.55]], true);
  lake = makePath(geography.features.find(f => f.id === 132616186)!.points, true);
}

/** A local geographic chart. No map requests, bitmap downloads or runtime dependencies. */
export function renderChart(ctx: CanvasRenderingContext2D, state: MapState, config: MapConfig) {
  prepare();
  const scale = worldScale(state.zoom, config.tileSize);
  const factor = scale / SCALE;
  ctx.fillStyle = '#edf0e4';
  ctx.fillRect(0, 0, state.width, state.height);
  ctx.save();
  ctx.translate((ORIGIN.x - state.worldCX) * scale + state.width / 2,
    (ORIGIN.y - state.worldCY) * scale + state.height / 2);
  ctx.scale(factor, factor);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Restrained natural areas, actual street geometry and a sandy coastline.
  for (const s of shapes!) {
    if (s.kind === 'wood' || s.kind === 'wetland' || s.kind === 'park') {
      ctx.fillStyle = s.kind === 'wetland' ? '#cfddc8' : '#d9e3ce';
      ctx.fill(s.path);
      ctx.strokeStyle = '#c8d8be';
      ctx.lineWidth = 1 / factor;
      ctx.stroke(s.path);
    }
  }
  for (const s of shapes!) {
    if (s.kind !== 'road') continue;
    ctx.strokeStyle = s.major ? '#d6d9c9' : '#e0e3d6';
    ctx.lineWidth = (s.major ? 7 : 3.5) / Math.sqrt(factor);
    ctx.stroke(s.path);
    ctx.strokeStyle = '#fafaf2';
    ctx.lineWidth = (s.major ? 4.5 : 2) / Math.sqrt(factor);
    ctx.stroke(s.path);
  }
  ctx.fillStyle = '#b7d7d5';
  ctx.fill(sea);
  ctx.strokeStyle = '#e9dec0';
  ctx.lineWidth = 15;
  ctx.stroke(coast);
  ctx.strokeStyle = '#f8f2df';
  ctx.lineWidth = 7;
  ctx.stroke(coast);
  for (const s of shapes!) {
    if (s.kind !== 'water') continue;
    ctx.strokeStyle = '#ccdabb';
    ctx.lineWidth = 14;
    ctx.stroke(s.path);
    ctx.strokeStyle = '#dce9d2';
    ctx.lineWidth = 7;
    ctx.stroke(s.path);
    const water = ctx.createLinearGradient(-550, -200, 600, 450);
    water.addColorStop(0, '#6aaea3');
    water.addColorStop(0.5, '#499b96');
    water.addColorStop(1, '#73b2a6');
    ctx.fillStyle = water;
    ctx.fill(s.path);
    ctx.strokeStyle = '#a6cec0';
    ctx.lineWidth = 2.5;
    ctx.stroke(s.path);
  }

  // Fine, fixed water texture, painted only when the camera changes.
  ctx.save();
  ctx.clip(lake);
  ctx.lineWidth = 0.6 / factor;
  ctx.strokeStyle = 'rgba(234,255,245,.15)';
  ctx.beginPath();
  for (let y = -500; y < 650; y += 19) {
    for (let x = -1500; x < 850; x += 37) {
      const offset = Math.sin(y * 0.12 + x * 0.07) * 9;
      ctx.moveTo(x + offset, y);
      ctx.quadraticCurveTo(x + 5 + offset, y + 1.5, x + 11 + offset, y);
    }
  }
  ctx.stroke();
  ctx.restore();
  ctx.restore();

  label(ctx, state, config, -22.4046, -41.8304, 'MIRANTE DA LAGOA', '', '#819481', 0);
  label(ctx, state, config, -22.4203, -41.8135, 'O C E A N O   A T L Â N T I C O', '', '#678f94', -0.48);
  label(ctx, state, config, -22.410, -41.810, 'PRAIA DO PECADO', '', '#8e967e', -0.48);
}

function label(ctx: CanvasRenderingContext2D, state: MapState, config: MapConfig,
  lat: number, lon: number, title: string, subtitle: string, color: string, rotation: number) {
  const p = geoToWorld(lat, lon);
  const s = worldScale(state.zoom, config.tileSize);
  const x = (p.x - state.worldCX) * s + state.width / 2;
  const y = (p.y - state.worldCY) * s + state.height / 2;
  if (x < -200 || x > state.width + 200 || y < 0 || y > state.height) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.textAlign = 'center';
  ctx.fillStyle = color;
  ctx.font = `${subtitle ? '500 12' : '500 10'}px system-ui, sans-serif`;
  ctx.fillText(title, 0, 0);
  if (subtitle) {
    ctx.globalAlpha = 0.65;
    ctx.font = 'italic 12px Georgia, serif';
    ctx.fillText(subtitle, 0, 22);
  }
  ctx.restore();
}
