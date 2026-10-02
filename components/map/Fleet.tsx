'use client';
import { memo, useEffect, useRef } from 'react';
import type { Boat } from '@/lib/map/types';
import { isRecentPosition, positionAge } from '@/lib/tracker/freshness';

const initials = (name: string) => name.split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase() || name.slice(0, 2).toUpperCase();
const support = (b: Boat) => b.type === 'jetski' || b.type === 'support';

/** Team logo in a ring of the boat colour; initials until (or unless) the logo loads. */
export function TeamAvatar({boat}: {boat: Pick<Boat, 'label' | 'logo' | 'accentColor'>}) {
  return (
    <span className="fleet-chip__avatar" style={{'--boat-color': boat.accentColor} as React.CSSProperties} aria-hidden="true">
      <span>{initials(boat.label)}</span>
      {/* Small remote team logos, lazy-loaded: no next/image optimisation needed. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {boat.logo && <img src={boat.logo} alt="" width={36} height={36} loading="lazy" decoding="async" onError={e => { e.currentTarget.hidden = true; }}/>}
    </span>
  );
}

type ChipProps = {id: string; label: string; logo?: string; accentColor: string; role: string | null; detail: string; pressed: boolean; onSelect: (id: string) => void};

/** One team chip. Memoised on primitives: the 2 Hz fleet refresh only touches chips whose text changed. */
const FleetChip = memo(function FleetChip({id, label, logo, accentColor, role, detail, pressed, onSelect}: ChipProps) {
  return (
    <button data-boat={id} className={`fleet-chip${role ? ' fleet-chip--support' : ''}`} aria-pressed={pressed}
      onClick={() => onSelect(id)} aria-label={`Acompanhar ${label}`} style={{'--boat-color': accentColor} as React.CSSProperties}>
      <TeamAvatar boat={{label, logo, accentColor}}/>
      <span className="fleet-chip__text"><strong>{label}</strong><span>{role ?? detail}</span></span>
    </button>
  );
});

/**
 * The fleet at a glance. Phones: one slim, horizontally scrolling row of team chips
 * above the bottom edge. Larger screens: a compact list. Tapping a chip follows the boat.
 */
export const Fleet = memo(function Fleet({fleet, selected, demo, onSelect, onBusy}: {
  fleet: Boat[]; selected: string | null; demo: boolean; onSelect: (id: string) => void;
  /** True while the list is being touched or scrolled, so the map can ease off the GPU. */
  onBusy?: (busy: boolean) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  // Keep the followed team in view on the strip.
  useEffect(() => {
    if (!selected) return;
    const chip = list.current?.querySelector<HTMLElement>(`[data-boat="${CSS.escape(selected)}"]`);
    chip?.scrollIntoView({behavior: 'smooth', block: 'nearest', inline: 'center'});
  }, [selected]);
  // Busy from the first touch until the fling has settled.
  useEffect(() => {
    const el = list.current;
    if (!el || !onBusy) return;
    let touching = false, busy = false, idle: ReturnType<typeof setTimeout> | undefined;
    const set = (value: boolean) => { if (value !== busy) { busy = value; onBusy(value); } };
    const settle = () => { clearTimeout(idle); idle = setTimeout(() => { if (!touching) set(false); }, 180); };
    const down = () => { touching = true; set(true); };
    const up = () => { touching = false; settle(); };
    const scroll = () => { set(true); settle(); };
    el.addEventListener('pointerdown', down, {passive: true});
    el.addEventListener('scroll', scroll, {passive: true});
    for (const evt of ['pointerup', 'pointercancel'] as const) el.addEventListener(evt, up, {passive: true});
    return () => {
      clearTimeout(idle); set(false);
      el.removeEventListener('pointerdown', down); el.removeEventListener('scroll', scroll);
      for (const evt of ['pointerup', 'pointercancel'] as const) el.removeEventListener(evt, up);
    };
  }, [onBusy]);
  const ordered = [...fleet].sort((a, b) => Number(support(a)) - Number(support(b)));
  return (
    <nav className="fleet" aria-label="Embarcações">
      <div className="fleet__head"><span className="eyebrow">{demo ? 'DEMONSTRAÇÃO' : 'AO VIVO'}</span><strong>Embarcações <span className="count-badge">{fleet.filter(b => !support(b)).length}</span></strong></div>
      <div className="fleet__list" ref={list}>
        {ordered.map(boat => {
          const stale = !demo && !isRecentPosition(boat.capturedAt);
          const speed = !stale && (demo || boat.speedKnown) ? `${boat.speed.toFixed(1)} nós` : stale ? positionAge(boat.capturedAt) : '—';
          const role = boat.type === 'jetski' ? 'Resgate' : boat.type === 'support' ? 'Apoio' : null;
          return <FleetChip key={boat.id} id={boat.id} label={boat.label} logo={boat.logo} accentColor={boat.accentColor}
            role={role} detail={speed} pressed={selected === boat.id} onSelect={onSelect}/>;
        })}
        {fleet.length === 0 && <p className="fleet__empty">Nenhum barco na água agora.</p>}
      </div>
    </nav>
  );
});
