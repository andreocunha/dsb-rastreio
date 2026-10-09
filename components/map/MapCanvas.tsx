'use client';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { initEngine, type EngineAPI, type LiveBoat } from '@/lib/map/engine';
import { ROUTE_COLORS, type Boat, type EditTool } from '@/lib/map/types';
import { Icon } from './Icon';
import { venueById } from '@/lib/map/venues';
import { feedStatusFor, feedToneFor, isRecentPosition } from '@/lib/tracker/freshness';
import { SosNotices, type PublicSos } from '@/lib/tracker/sos-notices';
import { SosNotice } from './SosNotice';
import { Fleet, TeamAvatar } from './Fleet';
import { AdminPanel } from '@/components/admin/AdminPanel';
import { adminFetch, hasAdminSession } from '@/lib/tracker/admin-session';
import { COURSE_PRESETS, CUSTOM_COURSE_ID } from '@/lib/map/courses';
import { areasRowId, courseRowId, parseAreas, parseGeometry, parseLiveCourse } from '@/lib/map/course-data';

const TOOLS = [
  {id: 'buoy', label: 'Boias', icon: 'buoy', hint: 'Arraste uma boia para mover. Toque na água para adicionar ou numa boia para remover.'},
  {id: 'route', label: 'Percurso', icon: 'route', hint: 'Toque num ponto para escolher o percurso. Arraste os pontos para ajustar, toque sobre a linha para inserir um ponto ou na água para continuar.'},
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

export default function MapCanvas() {
  const threeRef = useRef<HTMLCanvasElement>(null);
  const [view3D,setView3D]=useState(false);
  const [loading3D,setLoading3D]=useState(false);
  const [viewMessage,setViewMessage]=useState('');
  const [photographic,setPhotographic]=useState(true);
  const [demo,setDemo]=useState(false);
  const [demoPaused,setDemoPaused]=useState(false);
  const [demoSpeed,setDemoSpeed]=useState(1);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const backgroundRef = useRef<HTMLCanvasElement>(null);
  const compassRef = useRef<HTMLButtonElement>(null);
  const engineRef = useRef<EngineAPI>(null);
  const editorRef = useRef<HTMLElement>(null);
  const [compactEditor, setCompactEditor] = useState(false);
  const [activeTool, setActiveTool] = useState<EditTool>(null);
  const [routeColor, setRouteColor] = useState(ROUTE_COLORS[0].hex);
  const [editing, setEditing] = useState(false);
  const [embed, setEmbed] = useState(false);
  const [viewMenu, setViewMenu] = useState(false);
  const [feedStatus, setFeedStatus] = useState('Conectando…');
  const [feedTone, setFeedTone] = useState<'live' | 'stale' | 'wait' | 'demo'>('wait');
  const [selected, setSelected] = useState<string | null>(null);
  const [fleet, setFleet] = useState<Boat[]>([]);
  const [style, setStyle] = useState<'chart' | 'satellite'>('chart');
  const [isAdmin, setIsAdmin] = useState(false);
  // The DSB app adds ?admin=1 for organizers: an "Organização" button opens the panel (signed in with their account).
  const [adminInvited, setAdminInvited] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [live, setLive] = useState<{venue: string; course: string} | null>(null);
  const [saveState, setSaveState] = useState<{state: 'idle' | 'saving' | 'saved' | 'error'; message?: string}>({state: 'idle'});
  const storedRef = useRef(new Map<string, unknown>());
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pendingEdit = useRef<unknown>(null);
  const [venueId, setVenueId] = useState('imboassica');
  const [courseId, setCourseId] = useState(COURSE_PRESETS[0].id);
  const [canUndo, setCanUndo] = useState(false);
  const [sosQueue,setSosQueue] = useState<PublicSos[]>([]);
  const dismissSos = useCallback(()=>setSosQueue(queue=>queue.slice(1)),[]);

  const mobile = useSyncExternalStore(subscribeMobile, getMobile, serverMobile);
  const online = useSyncExternalStore(subscribeOnline, getOnline, serverOnline);
  const fitVisibleCourse = useCallback(() => {
    const panel = editing ? editorRef.current?.getBoundingClientRect() : null;
    engineRef.current?.fit(panel ? mobile
      ? {top: 24, bottom: window.innerHeight - panel.top + 24, right: 24}
      : {right: window.innerWidth - panel.left + 24} : undefined);
  }, [editing, mobile]);
  // Organizer tools only for a signed-in operator (never inside the DSB app or the demo).
  useEffect(() => {
    if (embed || demo) return;
    let disposed = false;
    void hasAdminSession().then(admin => { if (!disposed) setIsAdmin(admin); });
    setAdminInvited(new URLSearchParams(location.search).get('admin') === '1');
    return () => { disposed = true; };
  }, [embed, demo]);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    let disposed = false;
    let check: ReturnType<typeof setInterval> | undefined;
    const cleanups: (() => void)[] = [];
    if (process.env.NODE_ENV === 'production') {
      // New versions apply by themselves (no "update" button). The worker activates as soon as it
      // has installed; here the page picks a moment that doesn't disturb anyone to reload:
      // right away while the visitor is still settling in, otherwise when the app goes to the background.
      const openedAt = performance.now(), updating = !!navigator.serviceWorker.controller;
      let touched = false, pending = false;
      const touch = () => { touched = true; };
      const reloadWhenHidden = () => { if (pending && document.hidden) location.reload(); };
      const onNewVersion = () => {
        if (!updating || disposed) return; // first install: this page already runs the current version
        if (!touched && performance.now() - openedAt < 15000) location.reload();
        else pending = true;
      };
      // The worker asks open pages whether they update by themselves (older ones get reloaded by it).
      const answer = (event: MessageEvent) => { if (event.data?.type === 'AUTO_UPDATE?') event.ports[0]?.postMessage('yes'); };
      navigator.serviceWorker.addEventListener('message', answer);
      cleanups.push(() => navigator.serviceWorker.removeEventListener('message', answer));
      addEventListener('pointerdown', touch, {passive: true, once: true});
      navigator.serviceWorker.addEventListener('controllerchange', onNewVersion);
      document.addEventListener('visibilitychange', reloadWhenHidden);
      cleanups.push(() => { removeEventListener('pointerdown', touch); navigator.serviceWorker.removeEventListener('controllerchange', onNewVersion); document.removeEventListener('visibilitychange', reloadWhenHidden); });
      navigator.serviceWorker.register('/sw.js', {updateViaCache: 'none'}).then(registration => {
        if (disposed) return;
        // A version installed by an older worker (that waited for the button): apply it now.
        registration.waiting?.postMessage({type: 'SKIP_WAITING'});
        // A race lasts hours: look for a new version every 15 minutes and whenever the app comes back.
        const look = () => { if (!document.hidden) registration.update().catch(() => {}); };
        check = setInterval(look, 15 * 60000);
        document.addEventListener('visibilitychange', look);
        cleanups.push(() => document.removeEventListener('visibilitychange', look));
      }).catch(() => { /* The chart remains usable if persistent storage is unavailable. */ });
    } else {
      // Production caches must never serve stale Next dev chunks or HMR responses.
      navigator.serviceWorker.getRegistrations().then(registrations => {
        for (const r of registrations) if (r.active?.scriptURL === `${location.origin}/sw.js`) r.unregister();
      });
    }
    return () => {
      disposed = true; clearInterval(check); for (const cleanup of cleanups) cleanup();
    };
  }, []);

  useEffect(() => {
    if (!canvasRef.current || !backgroundRef.current) return;
    const isDemo=new URLSearchParams(location.search).get('demo')==='1';
    setDemo(isDemo);
    // Inside the DSB app (iframe) spectators get a clean view: no venue or organizer tools.
    let framed=false;try{framed=window.self!==window.top;}catch{framed=true;}
    setEmbed(framed||new URLSearchParams(location.search).get('embed')==='1');
    const engine = initEngine(canvasRef.current, backgroundRef.current, undefined, {
      on3DFallback:()=>{setView3D(false);setLoading3D(false);setViewMessage('3D indisponível neste aparelho. Modo simplificado ativo.');},
      onView: (heading, tilted) => {
        // Updated per frame without React renders: rotate the needle, show only when turned or tilted.
        const compass = compassRef.current; if (!compass) return;
        const visible = heading !== null && (tilted || Math.min(heading, 360 - heading) > .5);
        if (compass.hidden === visible) compass.hidden = !visible;
        // Quarter-degree steps: no style invalidation while the heading is steady.
        const needle = visible ? `${-Math.round(heading! * 4) / 4}deg` : '';
        if (visible && compass.dataset.heading !== needle) { compass.dataset.heading = needle; compass.style.setProperty('--heading', needle); }
      },
      onSelectionChange: setSelected,
      onFleetUpdate: setFleet,
      onCourseEdit: edit => {
        // Debounced: one request after the organizer pauses, not one per drag frame.
        pendingEdit.current = edit; setSaveState({state: 'saving'});
        clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(async () => {
          const body = pendingEdit.current as {venue: string; course: string; geometry: unknown; areas: unknown};
          try {
            await adminFetch('/api/admin/course', {method: 'POST', json: {action: 'save', ...body}});
            storedRef.current.set(courseRowId(body.venue, body.course), body.geometry);
            storedRef.current.set(areasRowId(body.venue), body.areas);
            setSaveState({state: 'saved'});
          } catch (error) { setSaveState({state: 'error', message: (error as Error).message}); }
        }, 600);
      },
      onCourseChange: (id, undo) => { setCourseId(id); setCanUndo(undo); },
    }, !isDemo,isDemo);
    engineRef.current = engine;
    const initialVenue=venueById(isDemo?'imboassica':new URLSearchParams(location.search).get('venue') ?? undefined);
    if(initialVenue.id!=='imboassica') {engine.selectVenue(initialVenue.id);setVenueId(initialVenue.id);}
    let disposed=false, source:EventSource|null=null, first=true;
    let reconnect:ReturnType<typeof setTimeout>|undefined;
    let failures=0, sequence=0;
    let phase:'connecting'|'connected'|'disconnected'='connecting', healthy=false;
    const rows=new Map<string,LiveBoat>();
    const sosNotices=new SosNotices();
    function update() {
      if(isDemo)return;
      const boats=[...rows.values()];engine.setLiveBoats(boats);
      setFeedStatus(feedStatusFor(phase,healthy,boats));setFeedTone(feedToneFor(phase,healthy,boats));
      const wanted=new URLSearchParams(location.search).get('boat');
      if(first && wanted && rows.has(wanted)){engine.follow(wanted);first=false;}
    }
    // Position deltas can arrive many times a second (one per GPS fix): apply them in batches.
    // Motion is interpolated from each fix's own timestamp, so a 200 ms batch is invisible.
    let batch:ReturnType<typeof setTimeout>|undefined;
    const queueUpdate=()=>{batch??=setTimeout(()=>{batch=undefined;if(!disposed)update();},200);};
    // Optional boat style from the organization: "cat:2", "mono:1", or a rescue/support craft ("jetski:1", "support:1").
    const hulls=['cat','mono','jetski','support'] as const;
    const style=(value?:string)=>{const [hull,motors]=(value??'').split(':');return {hull:hulls.find(h=>h===hull) ?? 'cat',motors:Math.min(3,Math.max(1,Number(motors)||1))};};
    function decode(row:[string,string,string,number,number,number|null,number|null,number,string?,string?]):LiveBoat {
      return {id:row[0],label:row[1],color:row[2],...style(row[8]),logo:row[9]||undefined,lat:row[3]/1e7,lon:row[4]/1e7,speed:row[5]===null?null:row[5]/100*1.943844,heading:row[6],capturedAt:new Date(row[7]).toISOString()};
    }
    function connect() {
      if(isDemo||disposed||document.hidden||!navigator.onLine)return;
      source?.close();healthy=false;source=new EventSource('/api/tracker/stream');
      source.onopen=()=>{phase='connected';update();};
      source.addEventListener('snapshot',event=>{
        const data=JSON.parse(event.data);if(data.v!==1)return;
        rows.clear();for(const row of data.b)rows.set(row[0],decode(row));sequence=data.n;failures=0;update();
      });
      source.addEventListener('delta',event=>{
        const data=JSON.parse(event.data);
        if(data.n!==sequence+1){source?.close();connect();return;}sequence=data.n;
        for(const [id,label,color,look,logo] of data.m){const old=rows.get(id);rows.set(id,old?{...old,label,color,...style(look),logo:logo||undefined}:{id,label,color,...style(look),logo:logo||undefined,lat:0,lon:0,speed:null,heading:null,capturedAt:''});}
        for(const [id,lat,lon,speed,heading,time]of data.p){const old=rows.get(id);if(old)rows.set(id,{...old,lat:lat/1e7,lon:lon/1e7,speed:speed===null?null:speed/100*1.943844,heading,capturedAt:new Date(time).toISOString()});}
        for(const id of data.r)rows.delete(id);queueUpdate();

      });
      source.addEventListener('sos',event=>{
        const fresh=sosNotices.accept(JSON.parse(event.data).s);
        if(fresh.length)setSosQueue(queue=>[...queue,...fresh].slice(-100));
      });
      source.addEventListener('course',event=>{
        const course=parseLiveCourse(JSON.parse(event.data));
        if(!course)return;
        engine.applyLiveCourse(course);setLive({venue:course.venue,course:course.course});
      });
      source.addEventListener('health',event=>{healthy=JSON.parse(event.data).ok===true;update();});
      source.onerror=()=>{
        source?.close();phase='disconnected';healthy=false;update();
        // Jitter and a bounded backoff prevent a reconnect storm after an outage.
        const delay=Math.min(30000,1000*2**Math.min(failures++,5))+Math.random()*1000;
        clearTimeout(reconnect);reconnect=setTimeout(connect,delay);
      };
    }
    function visibility(){clearTimeout(reconnect);if(document.hidden){source?.close();source=null;}else connect();}
    document.addEventListener('visibilitychange',visibility);window.addEventListener('online',connect);
    connect();
    if(isDemo){setFeedStatus('Demonstração · Dados fictícios');setFeedTone('demo');engine.setLighting('noon');}
    let preference='';try{preference=localStorage.getItem('dsb:map:view')??'';}catch{}
    const requestedView=new URLSearchParams(location.search).get('view');
    // 3D is the default; the simplified view stays one tap away and is remembered.
    if(requestedView==='3d'||(requestedView!=='simple'&&preference!=='simple')){
      setLoading3D(true);void engine.set3D(threeRef.current).then(ok=>{if(!disposed){setView3D(ok);setLoading3D(false);}});
    }
    // Refresh stale labels locally even when there are no network changes.
    const staleTimer=setInterval(update,5000);
    return ()=>{disposed=true;clearTimeout(reconnect);clearTimeout(batch);clearInterval(staleTimer);source?.close();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('online',connect);engine.destroy();engineRef.current=null;};
  }, []);

  async function changeView(enabled:boolean) {
    if(loading3D)return;
    setViewMessage('');setLoading3D(enabled);
    if(enabled){setEditing(false);setActiveTool(null);engineRef.current?.setEditTool(null);}
    const ok=await engineRef.current?.set3D(enabled?threeRef.current:null)??false;
    setView3D(ok);setLoading3D(false);
    try{localStorage.setItem('dsb:map:view',ok?'3d':'simple');}catch{}
    const url=new URL(location.href);url.searchParams.set('view',ok?'3d':'simple');history.replaceState(null,'',url);
  }
  function openDemo(enabled:boolean){
    const url=new URL(location.href);url.searchParams.delete('boat');
    if(enabled){url.searchParams.set('demo','1');url.searchParams.set('venue','imboassica');url.searchParams.set('view','3d');}
    else url.searchParams.delete('demo');
    location.assign(url);
  }
  function pauseDemo(){const paused=!demoPaused;setDemoPaused(paused);engineRef.current?.setPaused(paused);}
  function selectTool(tool: EditTool) {
    const next = activeTool === tool ? null : tool;
    setActiveTool(next); engineRef.current?.setEditTool(next);
    if (next && mobile) setCompactEditor(true);
  }
  function closeEditor() {
    clearTimeout(saveTimer.current);
    setEditing(false); setActiveTool(null); engineRef.current?.endEdit();
  }
  /** Starts an edit session (the organizer's working copy, saved on the server as it changes). */
  async function openEditor() {
    if (editing) return;
    // Keep the current view (3D or not) and camera: editing works in both.
    setEditing(true); setActiveTool(null); setCompactEditor(false); setSaveState({state: 'idle'});
    engineRef.current?.follow(null); engineRef.current?.beginEdit();
    try {
      const result = await adminFetch<{rows: {id: string; data: unknown}[]}>('/api/admin/course');
      storedRef.current = new Map(result.rows.map(r => [r.id, r.data]));
    } catch (error) { setSaveState({state: 'error', message: (error as Error).message}); }
  }
  async function toggleEditor() { if (editing) closeEditor(); else await openEditor(); }
  function selectCourse(id: string) {
    const stored = storedRef.current;
    // The engine keeps the current tool while editing, so the panel keeps it selected too.
    engineRef.current?.loadCourse(venueId, id, parseGeometry(stored.get(courseRowId(venueId, id))), parseAreas(stored.get(areasRowId(venueId))));
    setSaveState({state: 'idle'});
  }
  async function publishCourse() {
    setSaveState({state: 'saving'});
    try {
      await adminFetch('/api/admin/course', {method: 'POST', json: {action: 'activate', venue: venueId, course: courseId}});
      setLive({venue: venueId, course: courseId}); setSaveState({state: 'saved'});
    } catch (error) { setSaveState({state: 'error', message: (error as Error).message}); }
  }
  // Stable callbacks: the fleet strip's chips stay memoised across the 2 Hz fleet refresh.
  const selectedRef = useRef(selected);
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  const selectBoat = useCallback((id: string) => engineRef.current?.follow(selectedRef.current === id ? null : id), []);
  const setUiBusy = useCallback((busy: boolean) => engineRef.current?.setUiBusy(busy), []);
  // Stable: the panel's sign-in effect must not re-run on every map render.
  const adminSignedIn = useCallback(() => setIsAdmin(true), []);
  function changeStyle() {
    if(view3D){setPhotographic(!photographic);engineRef.current?.setPhotographic(!photographic);return;}
    const next = style === 'chart' ? 'satellite' : 'chart';
    setStyle(next); engineRef.current?.setStyle(next);
  }
  const followed = fleet.find(b => b.id === selected);
  const currentCourse = venueId==='imboassica' && COURSE_PRESETS.find(p => p.id === courseId);
  // Without a published course yet, spectators see the first model.
  const isLive = (live?.venue ?? 'imboassica') === venueId && (live?.course ?? COURSE_PRESETS[0].id) === courseId;

  return (
    <main className={`race-app ${embed?'race-app--embed':''} ${style === 'satellite' || view3D ? 'race-app--satellite' : ''} ${followed ? 'race-app--following' : ''} ${view3D?'race-app--3d':''} ${loading3D&&!view3D?'race-app--preparing':''} ${demo?'race-app--demo':''} ${fleet.length?'':'race-app--no-fleet'}`}>
      {feedStatus && <div className="tracker-feed" data-tone={feedTone} role="status">{feedStatus}</div>}
      {/* The simulation stays for testing: open with ?demo=1. */}
      {demo && <div className="demo-controls" aria-label="Demonstração dos barcos">
        <><button onClick={pauseDemo}>{demoPaused?'▶ Continuar':'Ⅱ Pausar'}</button><select aria-label="Velocidade da demonstração" value={demoSpeed} onChange={e=>{const speed=Number(e.target.value);setDemoSpeed(speed);engineRef.current?.setDemoSpeed(speed);}}><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select><button onClick={()=>openDemo(false)}>Voltar ao vivo</button></>
      </div>}
      {sosQueue[0] && <SosNotice key={sosQueue[0][0]} notice={sosQueue[0]} onClose={dismissSos} canFollow={fleet.some(b=>b.id===sosQueue[0][1])} onFollow={()=>{engineRef.current?.follow(sosQueue[0][1]);dismissSos();}}/>}
      <div className={`view-controls ${viewMenu?'view-controls--open':''}`} aria-label="Visualização do mapa">
        <button className="view-toggle" onClick={()=>setViewMenu(!viewMenu)} aria-expanded={viewMenu} aria-label="Ajustes de visualização"><Icon name={viewMenu?'close':'layers'} size={18}/></button>
        <div className="view-panel">
          <div className="view-switch"><button onClick={()=>void changeView(false)} aria-pressed={!view3D} disabled={loading3D}>Simplificado</button><button onClick={()=>void changeView(true)} aria-pressed={view3D} disabled={loading3D}>{loading3D?'Preparando…':'3D'}</button></div>
          <button className="view-layer" onClick={changeStyle} aria-pressed={view3D?photographic:style==='satellite'} aria-label={(view3D?photographic:style==='satellite')?'Satélite':'Mapa ilustrado'} title={(view3D?photographic:style==='satellite')?'Satélite (toque para o mapa ilustrado)':'Mapa ilustrado (toque para o satélite)'}><Icon name="layers" size={15}/><span className="view-layer-label">{(view3D?photographic:style==='satellite')?'Satélite':'Mapa ilustrado'}</span></button>
        </div>
      </div>
      {viewMessage && <div className="view-message" role="status">{viewMessage}</div>}
      <div className="map-stage">
        <canvas ref={threeRef} className="map-three" aria-hidden="true"/>
        <canvas ref={backgroundRef} className="map-background" aria-hidden="true" />
        <canvas ref={canvasRef} className="map-canvas" aria-label={`Mapa · ${venueById(venueId).name}. Arraste para explorar.`} />
      </div>
      <Fleet fleet={fleet} selected={selected} demo={demo} onSelect={selectBoat} onBusy={setUiBusy}/>

      <div className="map-tools">
        <button ref={compassRef} className="map-tool map-compass" hidden onClick={() => engineRef.current?.resetView()} aria-label="Voltar ao norte e à vista de cima" title="Voltar ao norte (Ctrl/Shift + arrastar gira e inclina)"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 3l3.2 9H8.8z" fill="#d64541"/><path d="M12 21l-3.2-9h6.4z" fill="#9aa7a0"/><circle cx="12" cy="12" r="1.3" fill="#fff"/></svg></button>
        <div className="zoom-controls"><button onClick={() => engineRef.current?.zoom(0.5)} aria-label="Aproximar"><Icon name="plus"/></button><button onClick={() => engineRef.current?.zoom(-0.5)} aria-label="Afastar"><Icon name="minus"/></button></div>
        {(adminInvited || isAdmin) && !demo && <button className="map-tool map-admin" aria-expanded={adminOpen} aria-label="Painel da organização" title="Organização" onClick={() => setAdminOpen(!adminOpen)}><Icon name="shield"/></button>}
        {isAdmin&&!demo&&!embed&&<button className="map-tool map-edit" aria-label="Editar circuito" title="Editar circuito" aria-expanded={editing} aria-controls="course-editor" onClick={toggleEditor}><Icon name="settings"/></button>}
      </div>



      {followed && <section className="follow-card follow-card--active" aria-label="Detalhes da embarcação">
        <><TeamAvatar boat={followed}/><div className="follow-identity"><span className="eyebrow">ACOMPANHANDO</span><strong>{followed.label}</strong></div><div className="follow-stat"><strong>{(demo || (followed.speedKnown && isRecentPosition(followed.capturedAt))) ? followed.speed.toFixed(1) : '—'}<small> nós</small></strong><span>velocidade</span></div><div className="follow-stat follow-heading"><strong>{followed.heading.toFixed(0)}°</strong><span>direção</span></div><button className="icon-button" aria-label="Parar de acompanhar" onClick={() => engineRef.current?.follow(null)}><Icon name="close" size={16}/></button></>
      </section>}

      {editing && !adminOpen && <section ref={editorRef} id="course-editor" className={`editor-panel ${compactEditor && mobile ? 'editor-panel--compact' : ''}`} aria-label="Editor do circuito"><div className="editor-heading"><div><span className="eyebrow">ORGANIZAÇÃO</span><h2>Percursos</h2></div><button className="icon-button" onClick={toggleEditor} aria-label="Fechar editor"><Icon name="close" size={18}/></button></div>
        {venueId==='imboassica' && <label className="course-picker">Prova<select value={courseId} onChange={event => selectCourse(event.target.value)}>{COURSE_PRESETS.map(p => <option value={p.id} key={p.id}>{p.name}{live?.venue===venueId&&live.course===p.id?' · no ar':''}</option>)}<option value={CUSTOM_COURSE_ID}>Circuito livre{live?.venue===venueId&&live.course===CUSTOM_COURSE_ID?' · no ar':''}</option></select></label>}
        <div className="publish-row">{isLive ? <span className="live-badge">● No ar para o público</span> : <button className="publish-button" onClick={()=>void publishCourse()}>Mostrar esta prova ao público</button>}</div>
        {currentCourse && <div className="course-meta"><strong>{currentCourse.schedule}</strong><span>Traçado aproximado das referências</span></div>}
        <div className="editor-tools">{TOOLS.map(tool => <button key={tool.id} onClick={() => selectTool(tool.id)} aria-pressed={activeTool === tool.id}><Icon name={tool.icon}/><span>{tool.label}</span></button>)}</div><p className="editor-hint">{TOOLS.find(t => t.id === activeTool)?.hint || 'Escolha uma prova e uma ferramenta para ajustar seus pontos no mapa.'}</p>
        {activeTool === 'route' && <><div className="route-colors">{ROUTE_COLORS.map(c => <button key={c.id} aria-label={`Percurso ${c.label}`} aria-pressed={routeColor === c.hex} style={{background: c.hex}} onClick={() => {setRouteColor(c.hex); engineRef.current?.newRoute(c.hex);}}/>)}</div><div className="editor-actions"><button onClick={() => engineRef.current?.undoRoutePoint()}>Desfazer ponto</button><button onClick={() => engineRef.current?.newRoute(routeColor)}>Novo percurso</button><button onClick={() => engineRef.current?.deleteActiveRoute()}>Apagar percurso</button><button onClick={() => engineRef.current?.clearAllRoutes()}>Apagar todos</button></div></>}
        {activeTool === 'finish' && <button className="text-button" onClick={() => engineRef.current?.clearFinishLine()}>Limpar chegada</button>}
        {activeTool === 'maintenance' && <button className="text-button" onClick={() => engineRef.current?.clearMaintenanceArea()}>Limpar área de apoio</button>}
        {activeTool === 'waiting' && <button className="text-button" onClick={() => engineRef.current?.clearWaitingArea()}>Limpar área de espera</button>}
        {mobile && <button className="editor-expand" onClick={() => setCompactEditor(!compactEditor)} aria-expanded={!compactEditor}>{compactEditor ? 'Mais opções da prova' : 'Recolher opções'}</button>}
        <div className="course-actions"><button disabled={!canUndo} onClick={() => engineRef.current?.undoCourse()}>Desfazer ajuste</button>{currentCourse && <button onClick={() => engineRef.current?.resetCourse()}>Restaurar modelo</button>}<button onClick={fitVisibleCourse}>Enquadrar prova</button></div>
        <div className={`saved-note ${saveState.state==='error' ? 'saved-note--error' : ''}`} role="status"><Icon name={saveState.state==='error' ? 'offline' : 'check'} size={13}/>{saveState.state==='saving' ? 'Salvando…' : saveState.state==='error' ? (saveState.message || 'Não foi possível salvar.') : isLive ? 'Salvo no servidor · o público vê em segundos' : 'Salvo no servidor · ainda não publicado'}</div>
      </section>}
      {adminOpen && <AdminPanel mode="sheet" onClose={() => setAdminOpen(false)} onSignedIn={adminSignedIn} course={{
        courses: [...COURSE_PRESETS.map(p => ({id: p.id, name: p.name})), {id: CUSTOM_COURSE_ID, name: 'Circuito livre'}].map(c => ({...c, live: live?.venue === venueId && live.course === c.id})),
        current: courseId, isLive,
        select: id => { void openEditor().then(() => selectCourse(id)); },
        publish: () => { void publishCourse(); },
        editDrawing: () => { setAdminOpen(false); void openEditor(); },
      }}/>}
      {!online && style === 'satellite' && <div className="offline-notice" role="status">Satélite limitado às imagens já visitadas. <button onClick={changeStyle}>Usar mapa ilustrado</button></div>}
    </main>
  );
}
