'use client';
import { memo, useEffect, useRef } from 'react';
import type { Boat } from '@/lib/map/types';
import { isRecentPosition, positionAge } from '@/lib/tracker/freshness';

const initials = (name: string) => name.split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase() || name.slice(0, 2).toUpperCase();
const support = (b: Boat) => b.type === 'jetski' || b.type === 'support';

/** Team logo in a ring of the boat colour; initials until (or unless) the logo loads. */
export function TeamAvatar({boat}: {boat: Boat}) {
  return (
    <span className="fleet-chip__avatar" style={{'--boat-color': boat.accentColor} as React.CSSProperties} aria-hidden="true">
      <span>{initials(boat.label)}</span>
      {/* Small remote team logos, lazy-loaded: no next/image optimisation needed. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {boat.logo && <img src={boat.logo} alt="" width={36} height={36} loading="lazy" decoding="async" onError={e => { e.currentTarget.hidden = true; }}/>}
    </span>
  );
}

/**
 * The fleet at a glance. Phones: one slim, horizontally scrolling row of team chips
 * above the bottom edge. Larger screens: a compact list. Tapping a chip follows the boat.
 */
export const Fleet = memo(function Fleet({fleet, selected, demo, onSelect}: {
  fleet: Boat[]; selected: string | null; demo: boolean; onSelect: (id: string) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  // Keep the followed team in view on the strip.
  useEffect(() => {
    if (!selected) return;
    const chip = list.current?.querySelector<HTMLElement>(`[data-boat="${CSS.escape(selected)}"]`);
    chip?.scrollIntoView({behavior: 'smooth', block: 'nearest', inline: 'center'});
  }, [selected]);
  const ordered = [...fleet].sort((a, b) => Number(support(a)) - Number(support(b)));
  return (
    <nav className="fleet" aria-label="Embarcações">
      <div className="fleet__head"><span className="eyebrow">{demo ? 'DEMONSTRAÇÃO' : 'AO VIVO'}</span><strong>Embarcações <span className="count-badge">{fleet.filter(b => !support(b)).length}</span></strong></div>
      <div className="fleet__list" ref={list}>
        {ordered.map(boat => {
          const stale = !demo && !isRecentPosition(boat.capturedAt);
          const speed = !stale && (demo || boat.speedKnown) ? `${boat.speed.toFixed(1)} nós` : stale ? positionAge(boat.capturedAt) : '—';
          const role = boat.type === 'jetski' ? 'Resgate' : boat.type === 'support' ? 'Apoio' : null;
          return (
            <button key={boat.id} data-boat={boat.id} className={`fleet-chip${role ? ' fleet-chip--support' : ''}`} aria-pressed={selected === boat.id}
              onClick={() => onSelect(boat.id)} aria-label={`Acompanhar ${boat.label}`} style={{'--boat-color': boat.accentColor} as React.CSSProperties}>
              <TeamAvatar boat={boat}/>
              <span className="fleet-chip__text"><strong>{boat.label}</strong><span>{role ?? speed}</span></span>
            </button>
          );
        })}
        {fleet.length === 0 && <p className="fleet__empty">Nenhum barco na água agora.</p>}
      </div>
    </nav>
  );
});
