'use client';
import { useRef, useImperativeHandle, forwardRef, memo } from 'react';
import type { BoatScreenInfo } from '@/lib/map/engine';
export interface BoatLabelsHandle { update(boats: BoatScreenInfo[]): void; }
type Label = { element: HTMLDivElement; name: string; width: number; side: number };
type Box = { x: number; y: number; width: number; height: number };
const intersects = (a: Box, b: Box) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

export const BoatLabels = memo(forwardRef<BoatLabelsHandle>(function BoatLabels(_, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const elements = useRef(new Map<string, Label>());
  useImperativeHandle(ref, () => ({
    update(boats) {
      const container = containerRef.current;
      if (!container) return;
      const occupied: Box[] = [];
      // Keep the selected boat readable first; stable alternatives avoid jumping between sides.
      const ordered = [...boats].sort((a, b) => Number(b.isFollowed) - Number(a.isFollowed));
      for (const boat of ordered) {
        let label = elements.current.get(boat.id);
        if (!label) {
          const element = document.createElement('div');
          element.style.setProperty('--boat-color', boat.accentColor);
          container.appendChild(element);
          label = { element, name: '', width: 0, side: 0 };
          elements.current.set(boat.id, label);
        }
        const el = label.element;
        if (label.name !== boat.label) {
          el.textContent = boat.label;
          label.name = boat.label;
          label.width = Math.max(46, boat.label.length * 6.5);
        }
        // Support craft remain identifiable by their shape; reveal their name when selected.
        const support = boat.type === 'jetski' || boat.type === 'support';
        if ((support && !boat.isFollowed) || boat.x < 0 || boat.y < 0 || boat.x > window.innerWidth || boat.y > window.innerHeight) {
          el.hidden = true;
          continue;
        }
        const candidates = [
          {x: boat.x + 27, y: boat.y - 8, width: label.width, height: 17},
          {x: boat.x - label.width - 27, y: boat.y - 8, width: label.width, height: 17},
        ];
        const order = [label.side, 1 - label.side];
        let chosen = -1;
        for (const side of order) {
          const box = candidates[side];
          const padded = {x: box.x - 5, y: box.y - 5, width: box.width + 10, height: box.height + 10};
          if (box.x < 8 || box.x + box.width > window.innerWidth - 8 || box.y < 8 || box.y + box.height > window.innerHeight - 8) continue;
          if (occupied.some(other => intersects(padded, other))) continue;
          if (boats.some(other => other.id !== boat.id && intersects(padded, {x: other.x - 20, y: other.y - 23, width: 40, height: 46}))) continue;
          chosen = side;
          break;
        }
        // Suppress a crowded label rather than cover another boat. The fleet list is always available.
        if (chosen < 0 && !boat.isFollowed) { el.hidden = true; continue; }
        if (chosen < 0) chosen = boat.x + label.width + 27 < window.innerWidth ? 0 : 1;
        label.side = chosen;
        const box = candidates[chosen];
        occupied.push(box);
        el.hidden = false;
        const className = `boat-label boat-label--${chosen === 0 ? 'right' : 'left'}${boat.isFollowed ? ' boat-label--selected' : ''}`;
        if (el.className !== className) el.className = className;
        el.style.transform = `translate(${Math.round(box.x)}px,${Math.round(box.y)}px)`;
      }
      for (const [id, label] of elements.current) if (!boats.some(b => b.id === id)) { label.element.remove(); elements.current.delete(id); }
    },
  }));
  return <div ref={containerRef} className="boat-labels-container" aria-hidden="true" />;
}));
