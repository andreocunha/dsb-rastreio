'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react';
import type { PlayheadInfo } from '@/lib/map/engine';

function formatHMS(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '00:00';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function formatGap(ms: number): string {
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return s > 0 ? `${m}min ${s}s` : `${m}min`;
}

interface Props {
  info: PlayheadInfo;
  onSeek: (serverT: number | null) => void;
}

export function SeekBar({ info, onSeek }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [hoverPct, setHoverPct] = useState<number | null>(null);

  const totalMs = Math.max(0, info.liveT - info.raceStartT);
  const playMs = Math.max(0, info.playheadT - info.raceStartT);
  const progress = totalMs > 0 ? Math.min(1, playMs / totalMs) : 0;
  const liveGap = Math.max(0, info.liveT - info.playheadT);
  const showLoading = info.isLoading && !info.hasDataAtPlayhead;

  const seekFromClient = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el || totalMs <= 0) return;
    const rect = el.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    onSeek(info.raceStartT + pct * totalMs);
  }, [info.raceStartT, totalMs, onSeek]);

  // Global pointer listeners while dragging — keeps tracking even if the
  // pointer leaves the track element.
  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => seekFromClient(e.clientX);
    const up = () => setDragging(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [dragging, seekFromClient]);

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(true);
    seekFromClient(e.clientX);
  };

  const handleHover = (e: ReactMouseEvent<HTMLDivElement>) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setHoverPct(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
  };

  return (
    <>
      {showLoading && (
        <div className="seek-loading">
          <div className="seek-loading-spinner" />
          <span>carregando…</span>
        </div>
      )}
      <div className="seekbar">
        <span className="seekbar-time">{formatHMS(playMs)}</span>
        <div
          ref={trackRef}
          className="seekbar-track"
          onPointerDown={handlePointerDown}
          onMouseMove={handleHover}
          onMouseLeave={() => setHoverPct(null)}
        >
          <div className="seekbar-fill" style={{ width: `${progress * 100}%` }} />
          <div className="seekbar-handle" style={{ left: `${progress * 100}%` }} />
          {hoverPct !== null && totalMs > 0 && (
            <div className="seekbar-hover" style={{ left: `${hoverPct * 100}%` }}>
              {formatHMS(hoverPct * totalMs)}
            </div>
          )}
        </div>
        <span className="seekbar-time">{formatHMS(totalMs)}</span>
        {/* {!info.isLive && liveGap > 10_000 && (
          <span className="seekbar-badge" title="quanto a live avançou desde que você pausou">
            +{formatGap(liveGap)} ao vivo
          </span>
        )} */}
        <button
          type="button"
          className={`seekbar-live ${info.isLive ? 'seekbar-live--active' : ''}`}
          onClick={() => onSeek(null)}
        >
          <span className="seekbar-live-dot" />
          LIVE
        </button>
      </div>
    </>
  );
}
