'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { adminFetch, hasAdminSession, insideApp, loginWithApp, loginWithPassword, logout } from '@/lib/tracker/admin-session';
import { TEAM_COLORS, teamColor } from '@/lib/map/team-colors';
import { logoUrl } from '@/lib/map/logos';
import { positionAge } from '@/lib/tracker/freshness';
import { useBottomSheet } from '@/lib/ui/sheet';
import './admin.css';

type Team = {id: string; name: string; initials: string; color?: string; map_color?: string | null; logo?: string | null; boat_hull?: string; boat_motors?: number};
type Device = {id: string; display_code: string; team_id: string | null; enabled: boolean; created_at: string; last_seen_at: string | null};
type Alert = {id: string; team_id: string; status: string; received_at: string};
type Overview = {teams: Team[]; devices: Device[]; alerts: Alert[]; onTrip?: string[]};
type Tab = 'course' | 'boats' | 'sos';
type Confirm = {title: string; message: string; action: string; danger?: boolean; input: Record<string, unknown>; done?: string; keep?: boolean};

/** Map colour of a team: its own, or the DSB app's badge colour until one is picked. */
const colorOf = (team?: Team) => teamColor(team?.map_color ?? team?.color);
const HULLS: [string, string][] = [['cat', 'Catamarã'], ['mono', 'Monocasco'], ['jetski', 'Jet ski de resgate'], ['support', 'Barco de apoio']];
/** Rescue jet ski and support boat: tracked on the map, but not competitors. */
const isCraft = (team?: Team) => team?.boat_hull === 'jetski' || team?.boat_hull === 'support';
/** Boats registered in this panel can be deleted; the competition teams come from the DSB app. */
const isRegisteredHere = (team: Team) => team.id.startsWith('trk-');
// Competitors first, in name order with the boat number counting as a number ("2 - …" before "10 - …"), then rescue and support.
const byName = (a: Team, b: Team) => Number(isCraft(a)) - Number(isCraft(b)) || a.name.localeCompare(b.name, 'pt-BR', {numeric: true});
const typedCode = (value: unknown) => String(value ?? '').replace(/\s/g, '').toUpperCase();
/** For searching boat names: no accents, no case ("gunes" finds "Güneş"). */
const plain = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Boat chooser with a search box (a plain select is impossible to use with many boats). */
function BoatPicker({teams, onPick, onCancel}: {teams: Team[]; onPick: (team: Team) => void; onCancel: () => void}) {
  const [query, setQuery] = useState('');
  const found = teams.filter(t => plain(t.name).includes(plain(query.trim())));
  return <div className="adm-picker">
    <div className="adm-add-phone">
      <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar barco" aria-label="Buscar barco" autoComplete="off"
        onKeyDown={e => { if (e.key === 'Enter' && found.length === 1) { e.preventDefault(); onPick(found[0]); } else if (e.key === 'Escape') onCancel(); }} />
      <button type="button" className="adm-button" onClick={onCancel}>Cancelar</button>
    </div>
    <ul className="adm-phones">
      {found.map(t => <li key={t.id}><button type="button" className="adm-pick-row" onClick={() => onPick(t)}><TeamBadge team={t} size={28} /><span>{t.name}</span></button></li>)}
      {!found.length && <li className="adm-hint">Nenhum barco com esse nome.</li>}
    </ul>
  </div>;
}

/** The course the map is showing, and what the organizer can do with it (only on the map). */
export interface CourseControls {
  courses: {id: string; name: string; live: boolean}[];
  current: string;
  isLive: boolean;
  select: (id: string) => void;
  publish: () => void;
  /** Close the panel and edit buoys, routes and areas directly on the map. */
  editDrawing: () => void;
}

function TeamBadge({team, size = 40}: {team?: Team; size?: number}) {
  const logo = logoUrl(team?.logo);
  return <span className="adm-badge" style={{width: size, height: size, '--team': colorOf(team)} as React.CSSProperties}>
    {/* Small remote team logos: no next/image optimisation needed. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {logo ? <img src={logo} alt="" loading="lazy" /> : <b>{team?.initials ?? '—'}</b>}
  </span>;
}

/**
 * Organization panel: the race on the map, the boats (each with its tracker phone) and SOS. On the map it is a sheet
 * (bottom on phones, side on large screens); at /admin it is the whole page.
 */
export function AdminPanel({mode, onClose, onSignedIn, course}: {mode: 'sheet' | 'page'; onClose?: () => void; onSignedIn?: () => void; course?: CourseControls}) {
  const [state, setState] = useState<'checking' | 'out' | 'in'>('checking');
  const [loginError, setLoginError] = useState('');
  const [tab, setTab] = useState<Tab>(course ? 'course' : 'boats');
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [editingTeam, setEditingTeam] = useState<string | null>(null);
  const app = insideApp();
  // On phones the sheet behaves like the DSB app's: pull it down (or tap outside) to close.
  const sheetRef = useRef<HTMLElement>(null), backdropRef = useRef<HTMLDivElement>(null);
  const dismiss = useBottomSheet(sheetRef, backdropRef, onClose, mode === 'sheet');

  const refresh = useCallback(async () => setData(await adminFetch<Overview>('/api/admin/tracker')), []);
  const enter = useCallback(async (how: () => Promise<void>) => {
    setBusy(true); setLoginError('');
    try { await how(); setState('in'); onSignedIn?.(); await refresh(); } catch (e) { setLoginError((e as Error).message); setState('out'); } finally { setBusy(false); }
  }, [refresh, onSignedIn]);

  // Already signed in? Otherwise, inside the DSB app the account signs in by itself.
  useEffect(() => {
    let disposed = false;
    hasAdminSession().then(ok => {
      if (disposed) return;
      if (ok) { setState('in'); onSignedIn?.(); refresh().catch(e => setError((e as Error).message)); }
      else if (app) void enter(() => loginWithApp());
      else setState('out');
    });
    return () => { disposed = true; };
  }, [app, enter, refresh, onSignedIn]);

  // Live while open: SOS calls and phones coming online.
  useEffect(() => {
    if (state !== 'in') return;
    let active = true, timer: ReturnType<typeof setTimeout>;
    const poll = async () => { try { if (!document.hidden) await refresh(); } catch (e) { if (active) setError((e as Error).message); } finally { if (active) timer = setTimeout(poll, 4000); } };
    timer = setTimeout(poll, 4000);
    return () => { active = false; clearTimeout(timer); };
  }, [state, refresh]);

  // The confirmation stays in view under the tabs, so it leaves by itself.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  /** `keep`: the boat being edited stays open (phone actions inside it). Resolves true when saved. */
  async function mutate(input: Record<string, unknown>, done = 'Alteração salva.', keep = false) {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await adminFetch<{deleted?: number; kept?: string[]}>('/api/admin/tracker', {method: 'POST', json: input});
      await refresh(); setConfirm(null); if (!keep) setEditingTeam(null);
      if (result.deleted !== undefined) {
        const kept = result.kept?.length ?? 0;
        setNotice(`${result.deleted} ${result.deleted === 1 ? 'aparelho apagado' : 'aparelhos apagados'}.${kept ? ` ${kept} em viagem ${kept === 1 ? 'ficou' : 'ficaram'} (encerre a viagem antes).` : ''}`);
      } else setNotice(done);
      return true;
    }
    catch (e) { setError((e as Error).message); setConfirm(null); return false; }
    finally { setBusy(false); }
  }

  const teams = [...(data?.teams ?? [])].sort(byName);
  const team = (id: string | null) => data?.teams.find(t => t.id === id);
  const openAlerts = data?.alerts.length ?? 0;
  const tabs: [Tab, string][] = [...(course ? [['course', 'Prova'] as [Tab, string]] : []), ['boats', 'Barcos'], ['sos', openAlerts ? `SOS · ${openAlerts}` : 'SOS']];

  const body = state === 'checking' ? <p className="adm-note">{app ? 'Entrando com a sua conta DSB…' : 'Conectando…'}</p>
    : state === 'out' ? <div className="adm-card adm-signin">
      <h2>Acesso da organização</h2>
      {app ? <>
        <p>{loginError || 'Entrando com a sua conta DSB…'}</p>
        <button className="adm-button primary" disabled={busy} onClick={() => void enter(() => loginWithApp())}>{busy ? 'Entrando…' : 'Tentar de novo'}</button>
      </> : <form onSubmit={event => { event.preventDefault(); const password = String(new FormData(event.currentTarget).get('password') ?? ''); void enter(() => loginWithPassword(password)); }}>
        <p>Informe a senha da organização.</p>
        <label className="adm-field"><span>Senha</span><input type="password" name="password" autoComplete="current-password" required autoFocus /></label>
        {loginError && <p className="adm-error-text">{loginError}</p>}
        <button className="adm-button primary" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
      </form>}
    </div>
    : <>
      <div className="adm-tabs" role="radiogroup" aria-label="Seções do painel">
        {tabs.map(([id, label]) => <button key={id} role="radio" aria-checked={tab === id} className={id === 'sos' && openAlerts ? 'adm-tab-alert' : ''} onClick={() => setTab(id)}>{label}</button>)}
      </div>
      {error && <div className="adm-message adm-error" role="alert">{error}<button onClick={() => setError('')} aria-label="Fechar erro">×</button></div>}
      {notice && !error && <div className="adm-message" role="status">{notice}</div>}
      {!data ? <p className="adm-note">Carregando…</p>
        : tab === 'course' && course ? <CourseTab course={course} />
        : tab === 'boats' ? <BoatsTab teams={teams} devices={data.devices} onTrip={new Set(data.onTrip ?? [])} editing={editingTeam} setEditing={setEditingTeam} busy={busy} mutate={mutate} confirm={setConfirm} />
        : <SosTab alerts={data.alerts} team={team} busy={busy} confirm={setConfirm} />}
    </>;

  return <>
    {mode === 'sheet' && <div ref={backdropRef} className="adm-backdrop" onClick={() => dismiss()} />}
    <section ref={sheetRef} className={`dsb-admin dsb-admin--${mode}`} aria-label="Painel da organização">
    {mode === 'sheet' && <span className="adm-handle" aria-hidden="true" />}
    <header className="adm-head">
      <div><span className="adm-eyebrow">DESAFIO SOLAR BRASIL</span><h1>Organização</h1></div>
      <div className="adm-head-actions">
        {state === 'in' && !app && <button className="adm-button ghost" onClick={() => { void logout(); setState('out'); setData(null); }}>Sair</button>}
        {onClose && <button className="adm-icon" onClick={() => dismiss()} aria-label="Fechar painel">×</button>}
      </div>
    </header>
    <div className="adm-body">{body}</div>
    {confirm && <div className="adm-overlay" data-no-sheet-drag onClick={() => !busy && setConfirm(null)}>
      <div className="adm-dialog" role="dialog" aria-modal="true" aria-labelledby="adm-confirm" onClick={e => e.stopPropagation()}>
        <h2 id="adm-confirm">{confirm.title}</h2><p>{confirm.message}</p>
        <div className="adm-dialog-actions">
          <button className="adm-button" disabled={busy} onClick={() => setConfirm(null)}>Cancelar</button>
          <button autoFocus className={`adm-button ${confirm.danger ? 'danger-solid' : 'primary'}`} disabled={busy} onClick={() => void mutate(confirm.input, confirm.done, confirm.keep)}>{busy ? 'Salvando…' : confirm.action}</button>
        </div>
      </div>
    </div>}
    </section>
  </>;
}

function CourseTab({course}: {course: CourseControls}) {
  return <div className="adm-stack">
    <div className="adm-card adm-pad">
      <label className="adm-field"><span>Prova no mapa</span>
        <select value={course.current} onChange={e => course.select(e.target.value)}>
          {course.courses.map(c => <option key={c.id} value={c.id}>{c.name}{c.live ? ' · no ar' : ''}</option>)}
        </select>
      </label>
      {course.isLive ? <p className="adm-live">● No ar para o público</p>
        : <button className="adm-button primary adm-wide" onClick={course.publish}>Mostrar esta prova ao público</button>}
    </div>
    <div className="adm-card adm-pad">
      <h3>Desenho da prova</h3>
      <p className="adm-hint">Boias, percursos, chegada e áreas de apoio e de espera, direto no mapa. As mudanças são salvas sozinhas.</p>
      <button className="adm-button adm-wide" onClick={course.editDrawing}>Ajustar o desenho no mapa</button>
    </div>
  </div>;
}

type Mutate = (input: Record<string, unknown>, done?: string, keep?: boolean) => Promise<boolean>;
const seen = (device: Device) => device.last_seen_at ? `visto ${positionAge(device.last_seen_at)}` : 'nunca conectou';
const recent = (a: Device, b: Device) => (b.last_seen_at ?? '').localeCompare(a.last_seen_at ?? '');

/**
 * Boats and their tracker phones: the list shows each boat with the phone it is using; tapping one
 * opens that boat on its own screen (phones, and how it looks on the map). Phones not on a boat come last.
 */
function BoatsTab({teams, devices, onTrip, editing, setEditing, busy, mutate, confirm}: {teams: Team[]; devices: Device[]; onTrip: Set<string>; editing: string | null; setEditing: (id: string | null) => void; busy: boolean; mutate: Mutate; confirm: (c: Confirm) => void}) {
  const [adding, setAdding] = useState(false);
  const deviceOf = (teamId: string) => devices.find(d => d.enabled && d.team_id === teamId);
  /** Phones left ready on a boat: they send nothing until the organizer activates one. */
  const reservesOf = (teamId: string) => devices.filter(d => !d.enabled && d.team_id === teamId).sort(recent);
  // Phones not on a boat pile up (every phone that ever opened the tracker app), so they stay folded
  // away until asked for; the ones seen most recently come first.
  const [showSpare, setShowSpare] = useState(false);
  const [spareQuery, setSpareQuery] = useState('');
  const [picking, setPicking] = useState<string | null>(null);
  const spare = devices.filter(d => !d.team_id).sort(recent);
  const spareShown = spare.filter(d => d.display_code.includes(typedCode(spareQuery)));
  const endTrip = (device: Device, owner?: Team) => confirm({title: 'Encerrar viagem?', message: `${owner?.name ?? 'O barco'} sai do mapa ao vivo e o trajeto fica guardado no histórico. Desligue o tracker antes: se ele continuar enviando posições, uma nova viagem começa sozinha.`, action: 'Encerrar viagem', input: {action: 'endTrip', id: device.id}, keep: true});

  // The boat screen opens at its top; going back returns to where the list was.
  const wrap = useRef<HTMLDivElement>(null), listScroll = useRef(0);
  const open = (id: string) => { listScroll.current = wrap.current?.closest('.adm-body')?.scrollTop ?? 0; setEditing(id); };
  useEffect(() => { const body = wrap.current?.closest('.adm-body'); if (body) body.scrollTop = editing ? 0 : listScroll.current; }, [editing]);

  const boat = teams.find(t => t.id === editing);
  if (boat) return <div ref={wrap}>
    <BoatScreen key={boat.id} boat={boat} teams={teams} active={deviceOf(boat.id)} reserves={reservesOf(boat.id)} spare={spare} onTrip={onTrip}
      busy={busy} mutate={mutate} confirm={confirm} endTrip={endTrip} onBack={() => setEditing(null)} />
  </div>;

  const row = (boat: Team) => {
    const device = deviceOf(boat.id), trip = !!device && onTrip.has(device.id), reserves = reservesOf(boat.id).length;
    return <li key={boat.id}>
      <button className="adm-row" onClick={() => open(boat.id)}>
        <TeamBadge team={boat} />
        <span className="adm-row-main"><strong>{boat.name}</strong><small>{device ? <><code>{device.display_code}</code> · {seen(device)}</> : 'Sem aparelho ativo'}{reserves > 0 && ` · ${reserves} ${reserves === 1 ? 'reserva' : 'reservas'}`}</small></span>
        {trip && <span className="adm-tag on">Em viagem</span>}
        <span className="adm-chevron" aria-hidden="true">›</span>
      </button>
    </li>;
  };

  const spareRow = (device: Device) => {
    // Goes in as a spare: it only starts sending after Ativar inside the boat.
    const link = (owner: Team) => {
      setPicking(null);
      void mutate({action: 'addSpare', code: device.display_code, teamId: owner.id}, `${device.display_code} pronto como reserva de ${owner.name}. Ative no barco quando for usar.`);
    };
    return <li key={device.id} className="adm-device-item"><div className="adm-row adm-device">
      <span className="adm-row-main"><strong><code>{device.display_code}</code></strong><small>{seen(device)}</small></span>
      <span className="adm-row-actions">
        {onTrip.has(device.id) && <button className="adm-button small" disabled={busy} onClick={() => endTrip(device)}>Encerrar viagem</button>}
        <button className="adm-button small" disabled={busy} aria-expanded={picking === device.id} aria-label={`Deixar o aparelho ${device.display_code} pronto em um barco`} onClick={() => setPicking(picking === device.id ? null : device.id)}>Reserva de…</button>
        <button className="adm-icon danger" disabled={busy} aria-label={`Apagar aparelho ${device.display_code}`} onClick={() => confirm({title: 'Apagar aparelho?', message: `O aparelho ${device.display_code} sai da lista.`, action: 'Apagar', danger: true, input: {action: 'delete', id: device.id}})}>🗑</button>
      </span>
    </div>
    {picking === device.id && <BoatPicker teams={teams} onPick={link} onCancel={() => setPicking(null)} />}
    </li>;
  };

  const competitors = teams.filter(t => !isCraft(t)), craft = teams.filter(isCraft);
  return <div className="adm-stack" ref={wrap}>
    <p className="adm-hint">Toque em um barco para trocar o aparelho ou mudar como ele aparece no mapa.</p>
    <ul className="adm-card adm-list">{competitors.map(row)}</ul>
    {craft.length > 0 && <><h3 className="adm-section">Resgate e apoio <small>{craft.length}</small></h3><ul className="adm-card adm-list">{craft.map(row)}</ul></>}
    {adding ? <form className="adm-card adm-pad adm-form" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void mutate({action: 'createBoat', name: form.get('name'), initials: form.get('initials'), hull: form.get('hull')}, 'Barco cadastrado.').then(() => setAdding(false)); }}>
      <h3>Novo barco</h3>
      <div className="adm-two">
        <label className="adm-field"><span>Nome</span><input name="name" placeholder="Nome da equipe" maxLength={60} required autoFocus /></label>
        <label className="adm-field adm-narrow"><span>Sigla</span><input name="initials" placeholder="SOL" maxLength={3} required /></label>
      </div>
      <label className="adm-field"><span>Embarcação</span><select name="hull" defaultValue="cat"><option value="cat">Barco competidor</option><option value="jetski">Jet ski de resgate</option><option value="support">Barco de apoio</option></select></label>
      <div className="adm-dialog-actions"><button type="button" className="adm-button" onClick={() => setAdding(false)}>Cancelar</button><button className="adm-button primary" disabled={busy}>Cadastrar</button></div>
    </form> : <button className="adm-button adm-wide" onClick={() => setAdding(true)}>＋ Cadastrar barco</button>}
    {spare.length > 0 && <>
      <button className="adm-section adm-toggle" aria-expanded={showSpare} onClick={() => setShowSpare(!showSpare)}>Aparelhos sem barco <small>{spare.length}</small><span className="adm-chevron" aria-hidden="true">›</span></button>
      {showSpare && <>
        <p className="adm-hint">Aparelhos que abriram o DSB Tracker e não estão em nenhum barco. Toque em Reserva de… para deixar um deles pronto num barco; ele só envia posições depois de ativado no barco.</p>
        <input className="adm-search adm-code" value={spareQuery} onChange={e => setSpareQuery(e.target.value)} placeholder="Buscar ID" aria-label="Buscar aparelho pelo ID" maxLength={11} autoComplete="off" autoCapitalize="characters" spellCheck={false} />
        {spareShown.length ? <ul className="adm-card adm-list">{spareShown.map(spareRow)}</ul> : <p className="adm-hint">Nenhum aparelho com esse ID.</p>}
        {spare.length > 1 && <button className="adm-button danger adm-wide" disabled={busy} onClick={() => confirm({title: `Apagar ${spare.length} aparelhos?`, message: 'Todos os aparelhos sem barco saem da lista. O histórico dos barcos (trajetos, posições e SOS) continua guardado. Aparelhos numa viagem em andamento não são apagados.', action: 'Apagar todos', danger: true, input: {action: 'deleteMany', ids: spare.map(d => d.id)}})}>Apagar os {spare.length} aparelhos sem barco</button>}
      </>}
    </>}
  </div>;
}

/** One boat on its own screen: its phones (what changes during the race) or how it looks on the map. */
function BoatScreen({boat, teams, active, reserves, spare, onTrip, busy, mutate, confirm, endTrip, onBack}: {
  boat: Team; teams: Team[]; active?: Device; reserves: Device[]; spare: Device[]; onTrip: Set<string>; busy: boolean;
  mutate: Mutate; confirm: (c: Confirm) => void; endTrip: (device: Device, owner?: Team) => void; onBack: () => void;
}) {
  const [view, setView] = useState<'phones' | 'look'>('phones');
  const trip = !!active && onTrip.has(active.id);
  return <div className="adm-stack">
    <button className="adm-back" onClick={onBack}><span aria-hidden="true">‹</span> Barcos</button>
    <div className="adm-boat-head">
      <TeamBadge team={boat} size={48} />
      <div className="adm-row-main">
        <strong>{boat.name}</strong>
        <small>{trip ? <span className="adm-live">● Em viagem</span> : active ? 'Com aparelho ativo' : 'Sem aparelho ativo'}</small>
      </div>
    </div>
    <div className="adm-seg" role="radiogroup" aria-label="O que mudar no barco">
      <button role="radio" aria-checked={view === 'phones'} onClick={() => setView('phones')}>Aparelhos</button>
      <button role="radio" aria-checked={view === 'look'} onClick={() => setView('look')}>Nome e aparência</button>
    </div>
    {view === 'phones'
      ? <BoatPhones boat={boat} active={active} reserves={reserves} spare={spare} trip={trip} busy={busy} mutate={mutate} confirm={confirm} endTrip={endTrip} />
      : <BoatLook boat={boat} teams={teams} busy={busy} mutate={mutate} confirm={confirm} />}
  </div>;
}

/** The phone sending the boat's positions and the spares ready to take over (one tap to swap). */
function BoatPhones({boat, active, reserves, spare, trip, busy, mutate, confirm, endTrip}: {
  boat: Team; active?: Device; reserves: Device[]; spare: Device[]; trip: boolean; busy: boolean;
  mutate: Mutate; confirm: (c: Confirm) => void; endTrip: (device: Device, owner?: Team) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState('');
  const typed = typedCode(code);
  // From 3 characters on, phones without a boat whose ID has what was typed (tap to add).
  const suggestions = typed.length >= 3 && typed.length < 10 ? spare.filter(d => d.display_code.includes(typed)).slice(0, 5) : [];
  const add = (id = typed) => {
    if (!id) return;
    void mutate({action: 'addSpare', code: id, teamId: boat.id}, `${id} pronto como reserva de ${boat.name}.`, true).then(ok => { if (ok) { setCode(''); setAdding(false); } });
  };
  const activate = (device: Device) => confirm({
    title: active ? 'Trocar o aparelho ativo?' : 'Ativar aparelho?',
    message: `O aparelho ${device.display_code} passa a enviar as posições de ${boat.name}.${active ? ` O ${active.display_code} para de enviar e fica como reserva${trip ? ' (a viagem dele é encerrada)' : ''}. O barco continua o mesmo no mapa e no histórico.` : ''}`,
    action: 'Ativar', input: {action: 'bind', code: device.display_code, teamId: boat.id}, done: `${device.display_code} ativo em ${boat.name}.`, keep: true,
  });

  return <>
    <section className="adm-group">
      <h3 className="adm-label">Ativo agora</h3>
      {active
        ? <div className="adm-card adm-active">
          <span className="adm-dot" aria-hidden="true" />
          <span className="adm-row-main"><code>{active.display_code}</code><small>{seen(active)}</small></span>
          <button className="adm-button small ghost" disabled={busy} onClick={() => confirm({title: 'Desativar o aparelho?', message: `${boat.name} fica sem aparelho ativo e sai do mapa ao vivo. O ${active.display_code} para de enviar posições e fica como reserva.`, action: 'Desativar', input: {action: 'deactivate', teamId: boat.id}, done: `${active.display_code} desativado.`, keep: true})}>Desativar</button>
        </div>
        : <p className="adm-card adm-empty">Nenhum aparelho enviando posições. Ative uma reserva abaixo.</p>}
      {trip && <button className="adm-button adm-wide" disabled={busy} onClick={() => endTrip(active!, boat)}>Encerrar viagem</button>}
    </section>

    <section className="adm-group">
      <h3 className="adm-label">Reservas {reserves.length > 0 && <small>{reserves.length}</small>}</h3>
      {reserves.length > 0 && <ul className="adm-card adm-list">
        {reserves.map(device => <li key={device.id} className="adm-spare">
          <span className="adm-row-main"><code>{device.display_code}</code><small>{seen(device)}</small></span>
          <button className="adm-button small brand" disabled={busy} onClick={() => activate(device)}>Ativar</button>
          <button className="adm-icon" disabled={busy} aria-label={`Tirar o aparelho ${device.display_code} do barco`} onClick={() => void mutate({action: 'removeSpare', id: device.id}, `${device.display_code} saiu de ${boat.name}.`, true)}>×</button>
        </li>)}
      </ul>}
      {adding
        ? <div className="adm-card adm-pad">
          <div className="adm-add-phone">
            <input autoFocus value={code} onChange={e => setCode(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } else if (e.key === 'Escape') setAdding(false); }}
              placeholder="ID do aparelho" maxLength={11} autoComplete="off" autoCapitalize="characters" spellCheck={false} className="adm-code" aria-label="ID do aparelho" />
            <button className="adm-button primary" disabled={busy || !typed} onClick={() => add()}>Adicionar</button>
          </div>
          {suggestions.length > 0 && <ul className="adm-phones">
            {suggestions.map(d => <li key={d.id}><button className="adm-pick-row" disabled={busy} onClick={() => add(d.display_code)}>
              <code>{d.display_code}</code><small>{seen(d)}</small><span className="adm-pick-add">Adicionar</span>
            </button></li>)}
          </ul>}
          <p className="adm-hint">O código de 10 caracteres que aparece no DSB Tracker. <button className="adm-link" onClick={() => { setAdding(false); setCode(''); }}>Cancelar</button></p>
        </div>
        : <button className="adm-button adm-wide" onClick={() => setAdding(true)}>＋ Adicionar reserva</button>}
      <p className="adm-hint">Só o aparelho ativo envia posições. Ativar uma reserva troca na hora, e o anterior vira reserva.</p>
    </section>
  </>;
}

/** Name and how the boat looks on the map (colour, hull, outboards), saved together. */
function BoatLook({boat, teams, busy, mutate, confirm}: {boat: Team; teams: Team[]; busy: boolean; mutate: Mutate; confirm: (c: Confirm) => void}) {
  // Rescue and support craft have no motor count.
  const [hull, setHull] = useState(boat.boat_hull ?? 'cat');
  const motors = boat.boat_motors ?? 1;
  const save = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget), name = String(form.get('name') ?? '').trim();
    void mutate({action: 'saveBoat', teamId: boat.id, name, color: form.get('color'), hull, motors: Number(form.get('motors') ?? motors)}, `${name} salvo.`);
  };
  return <form className="adm-card adm-pad" onSubmit={save}>
    <label className="adm-field"><span>Nome</span><input name="name" defaultValue={boat.name} maxLength={60} required autoComplete="off" /></label>
    {!isRegisteredHere(boat) && <p className="adm-hint adm-tight">Muda também no app (resultados, fantasy e chat).</p>}
    <div className="adm-two">
      <label className="adm-field"><span>Embarcação</span><select value={hull} onChange={e => setHull(e.target.value)}>{HULLS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      {(hull === 'cat' || hull === 'mono') && <fieldset className="adm-field adm-motors"><span>Motores</span>
        <div className="adm-seg">{[1, 2, 3].map(n => <label key={n}><input type="radio" name="motors" value={n} defaultChecked={motors === n} /><span>{n}</span></label>)}</div>
      </fieldset>}
    </div>
    {hull !== (boat.boat_hull ?? 'cat') && (hull === 'jetski' || hull === 'support') && <p className="adm-hint adm-tight">Continua no mapa ao vivo, mas sai da classificação e da escalação do app.</p>}
    <fieldset className="adm-colors"><legend>Cor no mapa</legend>
      {TEAM_COLORS.map(({hex, label}) => {
        // Colours already on another boat are struck through, so each boat can keep its own.
        const taken = teams.filter(t => t.id !== boat.id && colorOf(t) === hex).map(t => t.name);
        return <label key={hex} title={taken.length ? `${label} · já usada por ${taken.join(', ')}` : label} className={taken.length ? 'taken' : undefined}><input type="radio" name="color" value={hex} defaultChecked={colorOf(boat) === hex} aria-label={label} /><span style={{background: hex}} /></label>;
      })}
    </fieldset>
    <p className="adm-hint adm-tight">As cores riscadas já estão em outro barco.</p>
    <button className="adm-button primary adm-wide" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button>
    {isRegisteredHere(boat) && <button type="button" className="adm-button danger adm-wide" disabled={busy} onClick={() => confirm({title: `Excluir ${boat.name}?`, message: `${boat.name} sai da lista e do mapa, e os trajetos, posições e SOS dele são apagados. Não dá para desfazer.`, action: 'Excluir', danger: true, input: {action: 'deleteBoat', teamId: boat.id}, done: `${boat.name} excluído.`})}>Excluir barco</button>}
  </form>;
}

function SosTab({alerts, team, busy, confirm}: {alerts: Alert[]; team: (id: string | null) => Team | undefined; busy: boolean; confirm: (c: Confirm) => void}) {
  if (!alerts.length) return <p className="adm-note">Nenhum pedido de apoio aberto.</p>;
  return <ul className="adm-card adm-list">{alerts.map(alert => {
    const owner = team(alert.team_id);
    return <li key={alert.id} className="adm-sos">
      <div className="adm-row"><TeamBadge team={owner} /><span className="adm-row-main"><strong>{owner?.name ?? alert.team_id}</strong><small>{alert.status === 'acknowledged' ? 'Apoio a caminho' : 'SOS recebido'} · {new Date(alert.received_at).toLocaleTimeString('pt-BR', {timeZone: 'America/Sao_Paulo'})}</small></span></div>
      <div className="adm-dialog-actions">
        {alert.status === 'open' && <button className="adm-button danger-solid" disabled={busy} onClick={() => confirm({title: 'Apoio a caminho?', message: 'Confirme somente após acionar a equipe. O piloto receberá essa confirmação.', action: 'Confirmar atendimento', input: {action: 'sos', id: alert.id, status: 'acknowledged'}})}>Confirmar atendimento</button>}
        <button className="adm-button" disabled={busy} onClick={() => confirm({title: 'Encerrar este SOS?', message: 'O pedido será encerrado e o piloto poderá abrir um novo SOS.', action: 'Encerrar', input: {action: 'sos', id: alert.id, status: 'resolved'}})}>Encerrar chamado</button>
      </div>
    </li>;
  })}</ul>;
}
