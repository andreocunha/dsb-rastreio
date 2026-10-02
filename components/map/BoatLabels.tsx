'use client';
import { useEffect, useRef, useImperativeHandle, forwardRef, memo } from 'react';
import type { BoatScreenInfo } from '@/lib/map/engine';
export interface BoatLabelsHandle { update(boats: BoatScreenInfo[]): void; }

type Side = 'top' | 'bottom' | 'right' | 'left';
const SIDES: Side[] = ['top', 'bottom', 'right', 'left'];
type Label = {
  element: HTMLDivElement; name: HTMLSpanElement; speed: HTMLSpanElement;
  text: string; width: number; side: Side; blockedSince: number; freeSince: number;
  shown: boolean; ox: number; oy: number; placed: boolean; alpha: number; time: number;
  color: string; followed: boolean;
};
type Box = { x: number; y: number; width: number; height: number };
const HEIGHT = 22, GAP = 8, SWITCH_MS = 450, HIDE_MS = 700, SHOW_MS = 250;
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

export const BoatLabels = memo(forwardRef<BoatLabelsHandle>(function BoatLabels(_, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const elements = useRef(new Map<string, Label>());
  // Read the container size only when it changes: reading clientWidth every frame forced a layout.
  const size = useRef({width: 0, height: 0});
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    size.current = {width: container.clientWidth, height: container.clientHeight};
    const observer = new ResizeObserver(([entry]) => { size.current = {width: entry.contentRect.width, height: entry.contentRect.height}; });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  useImperativeHandle(ref, () => ({
    update(boats) {
      const container = containerRef.current;
      if (!container) return;
      const now = performance.now();
      const {width, height} = size.current;
      const occupied: Box[] = [];
      // Boats themselves are obstacles too: a name never covers another hull.
      const hulls = boats.map(b => {const r = Math.max(10, b.size * .42); return {id: b.id, box: {x: b.x - r, y: b.y - r, width: r * 2, height: r * 2}};});
      // The followed boat is placed first; then top-to-bottom for a stable order.
      const ordered = [...boats].sort((a, b) => Number(b.isFollowed) - Number(a.isFollowed) || a.y - b.y);
      for (const boat of ordered) {
        let label = elements.current.get(boat.id);
        if (!label) {
          const element = document.createElement('div');
          element.className = 'boat-label';
          const dot = document.createElement('span'); dot.className = 'boat-label__dot';
          const name = document.createElement('span'); name.className = 'boat-label__name';
          const speed = document.createElement('span'); speed.className = 'boat-label__speed';
          element.append(dot, name, speed);
          container.appendChild(element);
          label = {element, name, speed, text: '', width: 0, side: 'top', blockedSince: 0, freeSince: 0, shown: false, ox: 0, oy: 0, placed: false, alpha: 0, time: now, color: '', followed: false};
          elements.current.set(boat.id, label);
        }
        const el = label.element;
        // Per-frame path: only touch styles when they change.
        if (label.color !== boat.accentColor) { label.color = boat.accentColor; el.style.setProperty('--boat-color', boat.accentColor); }
        if (label.followed !== boat.isFollowed) { label.followed = boat.isFollowed; el.classList.toggle('boat-label--selected', boat.isFollowed); }
        const speedText = boat.isFollowed && boat.speed > 0 ? `${boat.speed.toFixed(1)} nós` : '';
        const text = boat.label + speedText;
        if (label.text !== text) {
          if (label.name.textContent !== boat.label) label.name.textContent = boat.label;
          if (label.speed.textContent !== speedText) label.speed.textContent = speedText;
          // Tabular digits: "7.9" → "8.1" keeps the width, so only re-measure (a forced layout) when the length changes.
          if (label.text.length !== text.length) label.width = 0;
          label.text = text;
        }
        if (!label.width) label.width = el.offsetWidth || boat.label.length * 7 + 26;
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
          el.dataset.side = label.side;
          el.style.transform = `translate3d(${(boat.x + label.ox).toFixed(1)}px,${(boat.y + label.oy).toFixed(1)}px,0)`;
        }
        label.shown = visible;
        // Fades are driven by the frame loop: deterministic, and never stuck mid-transition.
        const step = Math.min(1, (now - label.time) / 220);
        label.time = now;
        const alpha = Math.max(0, Math.min(1, label.alpha + (visible ? step : -step)));
        if (alpha !== label.alpha) {
          label.alpha = alpha;
          el.style.opacity = alpha.toFixed(3);
          el.style.visibility = alpha > 0 ? 'visible' : 'hidden';
        }
      }
      for (const [id, label] of elements.current) if (!boats.some(b => b.id === id)) { label.element.remove(); elements.current.delete(id); }
    },
  }));
  return <div ref={containerRef} className="boat-labels-container" aria-hidden="true" />;
}));
