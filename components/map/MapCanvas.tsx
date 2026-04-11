'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import { initEngine, type EngineAPI } from '@/lib/map/engine';
import type { EditTool } from '@/lib/map/types';
import { ROUTE_COLORS } from '@/lib/map/types';
import { HUD, type HUDHandle } from './HUD';

const TOOLS: { id: Exclude<EditTool, null>; label: string; icon: React.ReactNode }[] = [
  {
    id: 'buoy',
    label: 'Boias',
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <circle cx="9" cy="10" r="4" stroke="currentColor" strokeWidth="1.5" />
        <line x1="9" y1="6" x2="9" y2="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M9 2 L13 4" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    ),
  },
  {
    id: 'route',
    label: 'Percurso',
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M3 14 L8 6 L12 10 L16 3" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2" />
        <path d="M14 3 L16 3 L16 5" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    ),
  },
  {
    id: 'finish',
    label: 'Chegada',
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <rect x="2" y="4" width="4" height="4" fill="currentColor" />
        <rect x="6" y="8" width="4" height="4" fill="currentColor" />
        <rect x="10" y="4" width="4" height="4" fill="currentColor" />
        <rect x="6" y="4" width="4" height="4" stroke="currentColor" strokeWidth="0.5" />
        <rect x="2" y="8" width="4" height="4" stroke="currentColor" strokeWidth="0.5" />
        <rect x="10" y="8" width="4" height="4" stroke="currentColor" strokeWidth="0.5" />
      </svg>
    ),
  },
  {
    id: 'maintenance',
    label: 'Manutenção',
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M4 5 L14 5 L13 14 L5 14 Z" stroke="currentColor" strokeWidth="1.3" strokeDasharray="3 2" />
        <path d="M7 8 L11 12 M11 8 L7 12" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    ),
  },
];

export default function MapCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hudRef = useRef<HUDHandle>(null);
  const engineRef = useRef<EngineAPI>(null);
  const [activeTool, setActiveTool] = useState<EditTool>(null);
  const [routeColor, setRouteColor] = useState(ROUTE_COLORS[0].hex);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = initEngine(canvas, undefined, {
      onTelemetryUpdate(_boatId, lat, lon, speed, heading) {
        hudRef.current?.update(lat, lon, speed, heading);
      },
    });

    engineRef.current = engine;
    return () => engine.destroy();
  }, []);

  const selectTool = useCallback((tool: EditTool) => {
    setActiveTool((prev) => {
      const next = prev === tool ? null : tool;
      engineRef.current?.setEditTool(next);
      return next;
    });
  }, []);

  const selectColor = useCallback((hex: string) => {
    setRouteColor(hex);
    engineRef.current?.newRoute(hex);
  }, []);

  const handleNewRoute = useCallback(() => {
    engineRef.current?.newRoute(routeColor);
  }, [routeColor]);

  const handleUndo = useCallback(() => {
    engineRef.current?.undoRoutePoint();
  }, []);

  return (
    <>
      <canvas ref={canvasRef} className="map-canvas" />

      <div className="toolbar">
        {TOOLS.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className={`toolbar-btn ${activeTool === tool.id ? `toolbar-btn--active toolbar-btn--${tool.id}` : ''}`}
            onClick={() => selectTool(tool.id)}
            aria-label={tool.label}
            aria-pressed={activeTool === tool.id}
          >
            {tool.icon}
            <span className="toolbar-btn-label">{tool.label}</span>
          </button>
        ))}

        {activeTool === 'finish' && (
          <button type="button" className="toolbar-btn toolbar-btn--danger" onClick={() => engineRef.current?.clearFinishLine()}>
            <span className="toolbar-btn-label">Limpar</span>
          </button>
        )}
        {activeTool === 'maintenance' && (
          <button type="button" className="toolbar-btn toolbar-btn--danger" onClick={() => engineRef.current?.clearMaintenanceArea()}>
            <span className="toolbar-btn-label">Limpar</span>
          </button>
        )}
      </div>

      {activeTool === 'route' && (
        <div className="route-panel">
          <div className="route-colors">
            {ROUTE_COLORS.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`route-color-btn ${routeColor === c.hex ? 'route-color-btn--active' : ''}`}
                style={{ background: c.hex }}
                onClick={() => selectColor(c.hex)}
                aria-label={c.label}
              />
            ))}
          </div>
          <div className="route-actions">
            <button type="button" className="toolbar-btn" onClick={handleUndo}>
              <span className="toolbar-btn-label">Desfazer</span>
            </button>
            <button type="button" className="toolbar-btn" onClick={handleNewRoute}>
              <span className="toolbar-btn-label">Novo percurso</span>
            </button>
            <button type="button" className="toolbar-btn toolbar-btn--danger" onClick={() => engineRef.current?.clearAllRoutes()}>
              <span className="toolbar-btn-label">Limpar tudo</span>
            </button>
          </div>
        </div>
      )}

      <HUD ref={hudRef} />
    </>
  );
}
