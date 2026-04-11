'use client';

import { useRef, useImperativeHandle, forwardRef, memo } from 'react';

export interface HUDHandle {
  update(lat: number, lon: number, speed: number, heading: number): void;
}

/** HUD overlay — updated via imperative handle, never re-renders */
export const HUD = memo(
  forwardRef<HUDHandle>(function HUD(_, ref) {
    const latRef = useRef<HTMLSpanElement>(null);
    const lonRef = useRef<HTMLSpanElement>(null);
    const spdRef = useRef<HTMLSpanElement>(null);
    const hdgRef = useRef<HTMLSpanElement>(null);

    useImperativeHandle(ref, () => ({
      update(lat, lon, speed, heading) {
        if (latRef.current) latRef.current.textContent = lat.toFixed(5);
        if (lonRef.current) lonRef.current.textContent = lon.toFixed(5);
        if (spdRef.current) spdRef.current.textContent = `${speed.toFixed(1)} kn`;
        if (hdgRef.current) hdgRef.current.textContent = `${heading.toFixed(0)}°`;
      },
    }));

    return (
      <div className="hud">
        <div className="hud-item">
          <span className="hud-label">Lat</span>
          <span className="hud-value" ref={latRef}>—</span>
        </div>
        <div className="hud-item">
          <span className="hud-label">Lon</span>
          <span className="hud-value" ref={lonRef}>—</span>
        </div>
        <div className="hud-item">
          <span className="hud-label">Vel</span>
          <span className="hud-value" ref={spdRef}>—</span>
        </div>
        <div className="hud-item">
          <span className="hud-label">Hdg</span>
          <span className="hud-value" ref={hdgRef}>—</span>
        </div>
      </div>
    );
  }),
);
