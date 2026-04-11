'use client';

import { useRef, useImperativeHandle, forwardRef, memo } from 'react';
import type { BoatScreenInfo } from '@/lib/map/engine';

export interface BoatLabelsHandle {
  update(boats: BoatScreenInfo[]): void;
}

/** DOM overlay for boat labels — positioned with CSS transform (GPU-accelerated, no jitter) */
export const BoatLabels = memo(
  forwardRef<BoatLabelsHandle>(function BoatLabels(_, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const elementsRef = useRef<Map<string, HTMLDivElement>>(new Map());

    useImperativeHandle(ref, () => ({
      update(boats: BoatScreenInfo[]) {
        const container = containerRef.current;
        if (!container) return;

        const seen = new Set<string>();

        for (const boat of boats) {
          seen.add(boat.id);
          let el = elementsRef.current.get(boat.id);

          if (!el) {
            el = document.createElement('div');
            el.className = 'boat-label';
            container.appendChild(el);
            elementsRef.current.set(boat.id, el);
          }

          // Position with transform3d (GPU layer, no reflow)
          el.style.transform = `translate3d(${boat.x}px,${boat.y}px,0)`;

          const isSupport = boat.type === 'jetski' || boat.type === 'support';

          if (boat.isFollowed) {
            el.className = 'boat-label boat-label--tooltip';
            el.innerHTML =
              `<span class="boat-label-name">${boat.label}</span>` +
              `<span class="boat-label-speed">${boat.speed.toFixed(1)} nós</span>`;
            el.style.borderColor = boat.accentColor;
          } else if (isSupport) {
            el.className = 'boat-label boat-label--support';
            el.innerHTML = '<span class="boat-label-cross">+</span>';
          } else {
            el.className = 'boat-label boat-label--id';
            const num = boat.label.replace(/[^\d]/g, '') || boat.id;
            el.textContent = num;
          }
        }

        // Remove labels for boats that no longer exist
        for (const [id, el] of elementsRef.current) {
          if (!seen.has(id)) {
            el.remove();
            elementsRef.current.delete(id);
          }
        }
      },
    }));

    return <div ref={containerRef} className="boat-labels-container" />;
  }),
);
