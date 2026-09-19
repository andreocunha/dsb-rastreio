'use client';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { initEngine, BOAT_DEFS, type EngineAPI } from '@/lib/map/engine';
import { ROUTE_COLORS, type Boat, type EditTool } from '@/lib/map/types';
import { BoatLabels, type BoatLabelsHandle } from './BoatLabels';
import { Icon } from './Icon';
import { COURSE_PRESETS, CUSTOM_COURSE_ID } from '@/lib/map/courses';

const TOOLS = [
  {id: 'buoy', label: 'Boias', icon: 'buoy', hint: 'Arraste uma boia para mover. Toque na água para adicionar ou numa boia para remover.'},
  {id: 'route', label: 'Percurso', icon: 'route', hint: 'Arraste os pontos para ajustar. Toque sobre uma linha para inserir um ponto, ou na água para continuar.'},
  {id: 'finish', label: 'Chegada', icon: 'flag', hint: 'Arraste as extremidades para ajustar a chegada. Para criar outra, marque dois pontos na água.'},
  {id: 'maintenance', label: 'Apoio', icon: 'tool', hint: 'Área comum a todas as provas. Arraste os cantos para ajustar ou toque na água para adicionar pontos.'},
  {id: 'waiting', label: 'Espera', icon: 'boat', hint: 'Área de espera dos competidores. Arraste os cantos para ajustar; a posição é compartilhada entre as provas.'},
] as const;
const subscribeOnline = (fn: () => void) => {
  window.addEventListener('online', fn); window.addEventListener('offline', fn);
  return () => { window.removeEventListener('online', fn); window.removeEventListener('offline', fn); };
};
const subscribeMobile = (fn: () => void) => {
  const query = window.matchMedia('(max-width: 699px)');
  query.addEventListener('change', fn);
  return () => query.removeEventListener('change', fn);
};
const getMobile = () => window.matchMedia('(max-width: 699px)').matches;
const serverMobile = () => false;
const getOnline = () => navigator.onLine;
const serverOnline = () => true;
const boatType = (type: string) => ({cat: 'Catamarã solar', mono: 'Monocasco solar', arrow: 'Barco solar', jetski: 'Resgate', support: 'Apoio'}[type]);

export default function MapCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const backgroundRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<BoatLabelsHandle>(null);
  const engineRef = useRef<EngineAPI>(null);
  const editorRef = useRef<HTMLElement>(null);
  const [compactEditor, setCompactEditor] = useState(false);
  const [activeTool, setActiveTool] = useState<EditTool>(null);
  const [routeColor, setRouteColor] = useState(ROUTE_COLORS[0].hex);
  const [editing, setEditing] = useState(false);
  const [fleetOpen, setFleetOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [fleet, setFleet] = useState<Boat[]>([]);
  const [style, setStyle] = useState<'chart' | 'satellite'>('chart');
  const [updateReady, setUpdateReady] = useState(false);
  const [saved, setSaved] = useState(true);
  const [courseId, setCourseId] = useState(COURSE_PRESETS[0].id);
  const [canUndo, setCanUndo] = useState(false);

  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const mobile = useSyncExternalStore(subscribeMobile, getMobile, serverMobile);
  const online = useSyncExternalStore(subscribeOnline, getOnline, serverOnline);
  const fitVisibleCourse = useCallback(() => {
    const panel = editing ? editorRef.current?.getBoundingClientRect() : null;
    engineRef.current?.fit(panel ? mobile
      ? {top: 24, bottom: window.innerHeight - panel.top + 24, right: 24}
      : {right: window.innerWidth - panel.left + 24} : undefined);
  }, [editing, mobile]);
  useEffect(() => {
    const frame = requestAnimationFrame(fitVisibleCourse);
    return () => cancelAnimationFrame(frame);
  }, [fitVisibleCourse, courseId, activeTool, compactEditor]);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    let disposed = false;
    if (process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js', {updateViaCache: 'none'}).then(registration => {
        if (disposed) return;
        registrationRef.current = registration;
        if (registration.waiting) setUpdateReady(true);
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          worker?.addEventListener('statechange', () => {
            if (!disposed && worker.state === 'installed' && navigator.serviceWorker.controller) setUpdateReady(true);
          });
        });
      }).catch(() => { /* The chart remains usable if persistent storage is unavailable. */ });
    } else {
      // Production caches must never serve stale Next dev chunks or HMR responses.
      navigator.serviceWorker.getRegistrations().then(registrations => {
        for (const r of registrations) if (r.active?.scriptURL === `${location.origin}/sw.js`) r.unregister();
      });
    }
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!canvasRef.current || !backgroundRef.current) return;
    const engine = initEngine(canvasRef.current, backgroundRef.current, undefined, {
      onBoatPositions: boats => labelsRef.current?.update(boats),
      onSelectionChange: setSelected,
      onFleetUpdate: setFleet,
      onSaveStatus: setSaved,
      onCourseChange: (id, undo) => { setCourseId(id); setCanUndo(undo); },
    });
    engineRef.current = engine;
    return () => { engine.destroy(); engineRef.current = null; };
  }, []);

  function selectTool(tool: EditTool) {
    const next = activeTool === tool ? null : tool;
    setActiveTool(next); engineRef.current?.setEditTool(next);
    if (next && mobile) setCompactEditor(true);
  }
  function toggleEditor() {
    setEditing(!editing); setActiveTool(null); engineRef.current?.setEditTool(null);
    setCompactEditor(false);
    if (!editing) { setFleetOpen(false); engineRef.current?.follow(null); }
  }
  function selectCourse(id: string) {
    if (engineRef.current?.selectCourse(id)) setActiveTool(null);
  }
  function selectBoat(id: string) {
    engineRef.current?.follow(selected === id ? null : id);
    setFleetOpen(false);
  }
  function changeStyle() {
    const next = style === 'chart' ? 'satellite' : 'chart';
    setStyle(next); engineRef.current?.setStyle(next);
  }
  function updateApp() {
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), {once: true});
    registrationRef.current?.waiting?.postMessage({type: 'SKIP_WAITING'});
  }
  const followed = fleet.find(b => b.id === selected);
  const visibleBoats = BOAT_DEFS.filter(b => supportOpen || b.id.startsWith('b'));
  const currentCourse = COURSE_PRESETS.find(p => p.id === courseId);

  return (
    <main className={`race-app ${style === 'satellite' ? 'race-app--satellite' : ''} ${followed ? 'race-app--following' : ''}`}>
      <div className="map-stage">
        <canvas ref={backgroundRef} className="map-background" aria-hidden="true" />
        <canvas ref={canvasRef} className="map-canvas" aria-label="Mapa da Lagoa de Imboassica. Arraste para explorar e selecione uma embarcação na lista para acompanhar." />
        <BoatLabels ref={labelsRef} />
      </div>
      <aside className={`fleet-panel ${fleetOpen ? 'fleet-panel--open' : ''}`} aria-label="Embarcações">
        <button className="fleet-heading" onClick={() => setFleetOpen(!fleetOpen)} disabled={!mobile} aria-expanded={!mobile || fleetOpen} aria-controls="fleet-list"><span><span className="eyebrow">ACOMPANHE A PROVA</span><strong>Embarcações <span className="count-badge">06</span></strong></span><Icon name="chevron" size={18}/></button>
        <div id="fleet-list" className="fleet-content">
          <div className="fleet-columns"><span>NA ÁGUA</span><span>VELOCIDADE</span></div>
          {visibleBoats.map(def => {
            const boat = fleet.find(b => b.id === def.id);
            return <button key={def.id} className={`fleet-boat ${selected === def.id ? 'fleet-boat--selected' : ''}`} onClick={() => selectBoat(def.id)} aria-label={`Acompanhar ${def.label}`} aria-pressed={selected === def.id}>
              <span className="boat-swatch" style={{color: def.accent}}><Icon name="boat" size={25}/></span>
              <span className="boat-identity"><strong>{def.label}</strong><span>{boat?.activity === 'waiting' ? 'Na espera' : boat?.activity === 'support' ? 'Em vigilância' : courseId === 'match-race' ? `Na prova · Raia ${boat?.raceRouteId?.split('-').pop() ?? '—'}` : boatType(def.type)}</span></span>
              <span className="boat-speed">{boat ? boat.speed.toFixed(1) : '—'}<small>nós</small></span>
            </button>;
          })}
          <button className="support-toggle" onClick={() => setSupportOpen(!supportOpen)} aria-expanded={supportOpen}><span>+ 3 embarcações de apoio</span><Icon name="chevron" size={13}/></button>
        </div>
      </aside>

      <div className="map-tools">
        <div className="zoom-controls"><button onClick={() => engineRef.current?.zoom(0.5)} aria-label="Aproximar"><Icon name="plus"/></button><button onClick={() => engineRef.current?.zoom(-0.5)} aria-label="Afastar"><Icon name="minus"/></button></div>
        <button className="map-tool" onClick={changeStyle} aria-label={style === 'chart' ? 'Ver satélite' : 'Ver mapa ilustrado'} title={style === 'chart' ? 'Ver satélite' : 'Ver mapa ilustrado'} aria-pressed={style === 'satellite'}><Icon name="layers"/></button>
        <button className="map-tool map-edit" aria-label="Editar circuito" title="Editar circuito" aria-expanded={editing} aria-controls="course-editor" onClick={toggleEditor}><Icon name="settings"/></button>
      </div>



      {followed && <section className="follow-card follow-card--active" aria-label="Detalhes da embarcação">
        <><span className="follow-icon" style={{color: followed.accentColor}}><Icon name="boat" size={27}/></span><div className="follow-identity"><span className="eyebrow">ACOMPANHANDO</span><strong>{followed.label}</strong></div><div className="follow-stat"><strong>{followed.speed.toFixed(1)}<small> nós</small></strong><span>velocidade</span></div><div className="follow-stat follow-heading"><strong>{followed.heading.toFixed(0)}°</strong><span>direção</span></div><button className="icon-button" aria-label="Parar de acompanhar" onClick={() => engineRef.current?.follow(null)}><Icon name="close" size={16}/></button></>
      </section>}

      {editing && <section ref={editorRef} id="course-editor" className={`editor-panel ${compactEditor && mobile ? 'editor-panel--compact' : ''}`} aria-label="Editor do circuito"><div className="editor-heading"><div><span className="eyebrow">ORGANIZAÇÃO · 2026</span><h2>Circuitos da prova</h2></div><button className="icon-button" onClick={toggleEditor} aria-label="Fechar editor"><Icon name="close" size={18}/></button></div>
        <label className="course-picker">Prova<select value={courseId} onChange={event => selectCourse(event.target.value)}>{COURSE_PRESETS.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}<option value={CUSTOM_COURSE_ID}>Circuito livre / anterior</option></select></label>
        {currentCourse && <div className="course-meta"><strong>{currentCourse.schedule}</strong><span>Traçado aproximado das referências</span></div>}
        <div className="editor-tools">{TOOLS.map(tool => <button key={tool.id} onClick={() => selectTool(tool.id)} aria-pressed={activeTool === tool.id}><Icon name={tool.icon}/><span>{tool.label}</span></button>)}</div><p className="editor-hint">{TOOLS.find(t => t.id === activeTool)?.hint || 'Escolha uma prova e uma ferramenta para ajustar seus pontos no mapa.'}</p>
        {activeTool === 'route' && <><div className="route-colors">{ROUTE_COLORS.map(c => <button key={c.id} aria-label={`Percurso ${c.label}`} aria-pressed={routeColor === c.hex} style={{background: c.hex}} onClick={() => {setRouteColor(c.hex); engineRef.current?.newRoute(c.hex);}}/>)}</div><div className="editor-actions"><button onClick={() => engineRef.current?.undoRoutePoint()}>Desfazer</button><button onClick={() => engineRef.current?.newRoute(routeColor)}>Novo percurso</button><button onClick={() => engineRef.current?.clearAllRoutes()}>Limpar</button></div></>}
        {activeTool === 'finish' && <button className="text-button" onClick={() => engineRef.current?.clearFinishLine()}>Limpar chegada</button>}
        {activeTool === 'maintenance' && <button className="text-button" onClick={() => engineRef.current?.clearMaintenanceArea()}>Limpar área de apoio</button>}
        {activeTool === 'waiting' && <button className="text-button" onClick={() => engineRef.current?.clearWaitingArea()}>Limpar área de espera</button>}
        {mobile && <button className="editor-expand" onClick={() => setCompactEditor(!compactEditor)} aria-expanded={!compactEditor}>{compactEditor ? 'Mais opções da prova' : 'Recolher opções'}</button>}
        <div className="course-actions"><button disabled={!canUndo} onClick={() => engineRef.current?.undoCourse()}>Desfazer ajuste</button>{currentCourse && <button onClick={() => engineRef.current?.resetCourse()}>Restaurar modelo</button>}<button onClick={fitVisibleCourse}>Enquadrar prova</button></div>
        <div className={`saved-note ${!saved ? 'saved-note--error' : ''}`} role="status"><Icon name={saved ? 'check' : 'offline'} size={13}/>{saved ? 'Ajustes salvos por prova neste aparelho' : 'Não foi possível salvar; mantenha esta prova aberta'}</div>
      </section>}
      {updateReady && <button className="update-notice" onClick={updateApp}>Nova versão disponível <strong>Atualizar ↗</strong></button>}
      {!online && style === 'satellite' && <div className="offline-notice" role="status">Satélite limitado às imagens já visitadas. <button onClick={changeStyle}>Usar mapa ilustrado</button></div>}
    </main>
  );
}
