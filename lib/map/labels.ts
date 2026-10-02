import type { BoatType } from './types';

/** A boat as seen on screen, in CSS pixels. */
export interface LabelBoat {
  id: string; label: string; type: BoatType; x: number; y: number; speed: number;
  isFollowed: boolean; accentColor: string;
  /** On-screen hull length in pixels, to keep labels clear of the boat. */
  size: number;
}
/** A label to draw this frame: its bitmap's top-left corner in CSS pixels. */
export interface PlacedLabel { id: string; x: number; y: number; alpha: number; bitmap: HTMLCanvasElement; key: string; followed: boolean }

type Side = 'top' | 'bottom' | 'right' | 'left';
const SIDES: Side[] = ['top', 'bottom', 'right', 'left'];
type Label = {
  name: string; speed: string; width: number; side: Side; blockedSince: number; freeSince: number;
  shown: boolean; ox: number; oy: number; placed: boolean; alpha: number; time: number;
  color: string; followed: boolean; x: number; y: number;
  /** Pre-rendered pill for the current text, colour, side, selection and density. */
  bitmap: HTMLCanvasElement | null; key: string;
};
type Box = { x: number; y: number; width: number; height: number };
const HEIGHT = 22, GAP = 8, SWITCH_MS = 450, HIDE_MS = 700, SHOW_MS = 250;
/** Room around the pill in a bitmap for its shadow and pointer. */
export const LABEL_PAD = 16;
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const intersects = (a: Box, b: Box) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

/** Offset from the boat centre to the label's top-left corner for each side. */
function offset(side: Side, width: number, radius: number) {
  switch (side) {
    case 'top': return {x: -width / 2, y: -radius - GAP - HEIGHT};
    case 'bottom': return {x: -width / 2, y: radius + GAP};
    case 'right': return {x: radius + GAP, y: -HEIGHT / 2};
    case 'left': return {x: -radius - GAP - width, y: -HEIGHT / 2};
  }
}

let measurer: CanvasRenderingContext2D | null = null;
function textWidth(text: string, weight: number) {
  measurer ??= document.createElement('canvas').getContext('2d');
  if (!measurer) return text.length * 6.5;
  measurer.font = `${weight} 11px ${FONT}`; measurer.letterSpacing = '0.1px';
  return measurer.measureText(text).width;
}
/** Pill layout: dot, name and (followed boat) speed. */
const labelWidth = (name: string, speed: string) => Math.ceil(6 + 9 + 6 + textWidth(name, 600) + (speed ? 6 + textWidth(speed, 500) : 0) + 9);

/** Draw a label once into its own small canvas; per frame it is only placed. */
function renderBitmap(label: Label, dpr: number) {
  const {width, side, followed, color} = label;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil((width + LABEL_PAD * 2) * dpr); canvas.height = Math.ceil((HEIGHT + LABEL_PAD * 2) * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, LABEL_PAD * dpr, LABEL_PAD * dpr);
  // Pill plus the small diamond that points at the boat.
  const shape = new Path2D();
  shape.roundRect(0, 0, width, HEIGHT, HEIGHT / 2);
  const [tx, ty] = side === 'top' ? [width / 2, HEIGHT] : side === 'bottom' ? [width / 2, 0] : side === 'right' ? [0, 11] : [width, 11];
  shape.moveTo(tx, ty - 5); shape.lineTo(tx + 5, ty); shape.lineTo(tx, ty + 5); shape.lineTo(tx - 5, ty); shape.closePath();
  ctx.save();
  ctx.shadowColor = followed ? 'rgba(0, 18, 20, .3)' : 'rgba(0, 18, 20, .28)';
  ctx.shadowBlur = (followed ? 14 : 10) * dpr; ctx.shadowOffsetY = (followed ? 3 : 2) * dpr;
  ctx.fillStyle = followed ? 'rgba(255, 255, 250, .96)' : 'rgba(8, 30, 32, .84)';
  ctx.fill(shape);
  ctx.restore();
  if (!followed) { ctx.strokeStyle = 'rgba(255, 255, 255, .08)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(.5, .5, width - 1, HEIGHT - 1, HEIGHT / 2 - .5); ctx.stroke(); }
  // Team dot with a light ring.
  const dot = (r: number, fill: string) => { ctx.beginPath(); ctx.arc(10.5, 11, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); };
  if (followed) dot(7.5, 'rgba(16, 48, 46, .25)');
  dot(6.5, followed ? '#fff' : 'rgba(255, 255, 255, .85)');
  dot(4.5, color);
  ctx.textBaseline = 'middle'; ctx.letterSpacing = '0.1px';
  ctx.fillStyle = followed ? '#10302e' : '#f4fbf8';
  ctx.font = `600 11px ${FONT}`; ctx.fillText(label.name, 21, 11.5);
  if (label.speed) {
    ctx.globalAlpha = .7; ctx.font = `500 11px ${FONT}`;
    ctx.fillText(label.speed, 21 + textWidth(label.name, 600) + 6, 11.5);
  }
  label.bitmap = canvas;
}

/**
 * Boat names: where each goes (clear of hulls and of each other, with hysteresis so they
 * don't flicker between sides) and how opaque it is. The result is drawn by the 3D scene as
 * sprites or, in the 2D map, onto its canvas. No DOM work per frame: as 13 positioned
 * elements the names cost a third of the main thread on mid-range phones.
 */
export class LabelLayout {
  private labels = new Map<string, Label>();
  private dpr = 0;

  layout(boats: LabelBoat[], width: number, height: number, now: number, dpr: number): PlacedLabel[] {
    if (dpr !== this.dpr) { this.dpr = dpr; for (const label of this.labels.values()) label.key = ''; }
    const occupied: Box[] = [];
    // Boats themselves are obstacles too: a name never covers another hull.
    const hulls = boats.map(b => {const r = Math.max(10, b.size * .42); return {id: b.id, box: {x: b.x - r, y: b.y - r, width: r * 2, height: r * 2}};});
    // The followed boat is placed first; then top-to-bottom for a stable order.
    const ordered = [...boats].sort((a, b) => Number(b.isFollowed) - Number(a.isFollowed) || a.y - b.y);
    for (const boat of ordered) {
      let label = this.labels.get(boat.id);
      if (!label) {
        label = {name: '', speed: '', width: 0, side: 'top', blockedSince: 0, freeSince: 0, shown: false, ox: 0, oy: 0, placed: false, alpha: 0, time: now, color: '', followed: false, x: 0, y: 0, bitmap: null, key: ''};
        this.labels.set(boat.id, label);
      }
      const speed = boat.isFollowed && boat.speed > 0 ? `${boat.speed.toFixed(1)} nós` : '';
      if (label.name !== boat.label || label.speed !== speed) {
        // Digits share one width: "7.9" → "8.1" keeps the pill, so only re-measure on a length change.
        if (label.name !== boat.label || label.speed.length !== speed.length) label.width = 0;
        label.name = boat.label; label.speed = speed;
      }
      label.color = boat.accentColor; label.followed = boat.isFollowed;
      if (!label.width) label.width = labelWidth(label.name, label.speed);
      const support = boat.type === 'jetski' || boat.type === 'support';
      const offscreen = boat.x < -40 || boat.y < -40 || boat.x > width + 40 || boat.y > height + 40;
      const radius = Math.max(9, boat.size * .42);
      const fits = (side: Side) => {
        const o = offset(side, label.width, radius);
        const box = {x: boat.x + o.x, y: boat.y + o.y, width: label.width, height: HEIGHT};
        if (box.x < 4 || box.y < 4 || box.x + box.width > width - 4 || box.y + box.height > height - 4) return null;
        const padded = {x: box.x - 3, y: box.y - 3, width: box.width + 6, height: box.height + 6};
        if (occupied.some(other => intersects(padded, other))) return null;
        if (hulls.some(h => h.id !== boat.id && intersects(padded, h.box))) return null;
        return box;
      };
      let want = !offscreen && (!support || boat.isFollowed);
      let box = want ? fits(label.side) : null;
      if (want && !box) {
        // Hysteresis: only move after the current side has been blocked for a while.
        if (!label.blockedSince) label.blockedSince = now;
        const alternative = SIDES.find(side => side !== label.side && fits(side));
        if (alternative && (now - label.blockedSince > SWITCH_MS || !label.placed || boat.isFollowed)) {
          label.side = alternative; box = fits(alternative); label.blockedSince = 0;
        } else if (!alternative && now - label.blockedSince < HIDE_MS && label.shown) {
          // Briefly overlapping: keep it where it is rather than blinking.
          const o = offset(label.side, label.width, radius);
          box = {x: boat.x + o.x, y: boat.y + o.y, width: label.width, height: HEIGHT};
        } else if (!alternative && boat.isFollowed) {
          const o = offset(label.side, label.width, radius);
          box = {x: boat.x + o.x, y: boat.y + o.y, width: label.width, height: HEIGHT};
        }
      } else if (box) label.blockedSince = 0;
      if (want && box) {
        if (!label.shown && !label.freeSince) label.freeSince = now;
        if (!label.shown && now - label.freeSince < SHOW_MS && label.placed) want = false;
      } else label.freeSince = 0;
      const visible = want && !!box;
      if (visible && box) {
        occupied.push(box);
        const target = {x: box.x - boat.x, y: box.y - boat.y};
        // The offset (not the position) eases, so side changes glide while tracking stays exact.
        if (!label.placed || !label.shown) { label.ox = target.x; label.oy = target.y; }
        else { label.ox += (target.x - label.ox) * .22; label.oy += (target.y - label.oy) * .22; }
        label.placed = true;
        label.x = boat.x + label.ox; label.y = boat.y + label.oy;
      }
      label.shown = visible;
      // Fades are driven by the frame loop: deterministic, and never stuck mid-transition.
      const step = Math.min(1, (now - label.time) / 220);
      label.time = now;
      label.alpha = Math.max(0, Math.min(1, label.alpha + (visible ? step : -step)));
    }
    for (const id of this.labels.keys()) if (!boats.some(b => b.id === id)) this.labels.delete(id);
    const placed: PlacedLabel[] = [];
    for (const [id, label] of this.labels) {
      if (label.alpha <= 0 || !label.placed) continue;
      const key = `${label.name}|${label.speed}|${label.width}|${label.side}|${label.followed}|${label.color}`;
      if (label.key !== key || !label.bitmap) { renderBitmap(label, dpr); label.key = key; }
      placed.push({id, x: label.x - LABEL_PAD, y: label.y - LABEL_PAD, alpha: label.alpha, bitmap: label.bitmap!, key, followed: label.followed});
    }
    // The followed boat's name is drawn last, on top.
    return placed.sort((a, b) => Number(a.followed) - Number(b.followed));
  }
}

/** 2D map: stamp the labels onto its canvas (already cleared and redrawn every frame). */
export function drawLabels(ctx: CanvasRenderingContext2D, placed: PlacedLabel[], dpr: number) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (const label of placed) {
    ctx.globalAlpha = label.alpha;
    ctx.drawImage(label.bitmap, label.x * dpr, label.y * dpr);
  }
  ctx.restore();
}
