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
type Confirm = {title: string; message: string; action: string; danger?: boolean; input: Record<string, unknown>; done?: string};

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

  async function mutate(input: Record<string, unknown>, done = 'Alteração salva.') {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await adminFetch<{deleted?: number; kept?: string[]}>('/api/admin/tracker', {method: 'POST', json: input});
      await refresh(); setConfirm(null); setEditingTeam(null);
      if (result.deleted !== undefined) {
        const kept = result.kept?.length ?? 0;
        setNotice(`${result.deleted} ${result.deleted === 1 ? 'aparelho apagado' : 'aparelhos apagados'}.${kept ? ` ${kept} em viagem ${kept === 1 ? 'ficou' : 'ficaram'} (encerre a viagem antes).` : ''}`);
      } else setNotice(done);
    }
    catch (e) { setError((e as Error).message); setConfirm(null); }
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
        : tab === 'boats' ? <BoatsTab teams={teams} devices={data.devices} onTrip={new Set(data.onTrip ?? [])} team={team} editing={editingTeam} setEditing={setEditingTeam} busy={busy} mutate={mutate} confirm={setConfirm} />
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
          <button autoFocus className={`adm-button ${confirm.danger ? 'danger-solid' : 'primary'}`} disabled={busy} onClick={() => void mutate(confirm.input, confirm.done)}>{busy ? 'Salvando…' : confirm.action}</button>
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

/**
 * Boats and their tracker phones in one list: each boat shows the ID of the phone it is using, and
 * tapping it edits everything about that boat (name, phone ID, map appearance) with a single save.
 * Phones not on a boat (never linked, or retired by a swap) come last.
 */
function BoatsTab({teams, devices, onTrip, team, editing, setEditing, busy, mutate, confirm}: {teams: Team[]; devices: Device[]; onTrip: Set<string>; team: (id: string | null) => Team | undefined; editing: string | null; setEditing: (id: string | null) => void; busy: boolean; mutate: (input: Record<string, unknown>, done?: string) => Promise<void>; confirm: (c: Confirm) => void}) {
  const [adding, setAdding] = useState(false);
  // The hull picked in the open form: rescue and support craft have no motor count.
  const [hull, setHull] = useState<string | null>(null);
  const open = (id: string | null) => { setHull(null); setEditing(id); };
  const deviceOf = (teamId: string) => devices.find(d => d.enabled && d.team_id === teamId);
  // Phones not on a boat pile up (every phone that ever opened the tracker app), so they stay folded
  // away until asked for; the ones seen most recently come first.
  const [showSpare, setShowSpare] = useState(false);
  const spare = devices.filter(d => !(d.enabled && d.team_id)).sort((a, b) => (b.last_seen_at ?? '').localeCompare(a.last_seen_at ?? ''));
  const seen = (device: Device) => device.last_seen_at ? `visto ${positionAge(device.last_seen_at)}` : 'nunca conectou';
  const endTrip = (device: Device, owner?: Team) => confirm({title: 'Encerrar viagem?', message: `${owner?.name ?? 'O barco'} sai do mapa ao vivo e o trajeto fica guardado no histórico. Desligue o tracker antes: se ele continuar enviando posições, uma nova viagem começa sozinha.`, action: 'Encerrar viagem', input: {action: 'endTrip', id: device.id}});
  /** What swapping in the phone `code` does to the boat's current phone and to the boat that has `code` today. */
  const swapNote = (boat: Team, code: string) => {
    const current = deviceOf(boat.id), holder = devices.find(d => d.display_code === code && d.enabled && d.team_id && d.team_id !== boat.id);
    return `${current ? ` O aparelho ${current.display_code} é desativado; o barco continua o mesmo no mapa e no histórico.` : ''}${holder ? ` ${team(holder.team_id)?.name ?? 'O outro barco'} fica sem aparelho.` : ''}`;
  };

  const row = (boat: Team) => {
    const device = deviceOf(boat.id), trip = !!device && onTrip.has(device.id);
    const draft = hull ?? boat.boat_hull ?? 'cat', motors = boat.boat_motors ?? 1;
    const save = (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget), name = String(form.get('name') ?? '').trim(), code = typedCode(form.get('code'));
      const input: Record<string, unknown> = {action: 'saveBoat', teamId: boat.id, name, color: form.get('color'), hull: form.get('hull'), motors: Number(form.get('motors') ?? motors)};
      const done = `${name} salvo.`;
      // The phone ID only goes along when it changed; swapping or unlinking a phone asks first.
      if (code === (device?.display_code ?? '')) { void mutate(input, done); return; }
      input.code = code;
      const note = swapNote(boat, code);
      if (!code) confirm({title: 'Desvincular o aparelho?', message: `${boat.name} fica sem aparelho e sai do mapa ao vivo. O aparelho ${device!.display_code} vai para a lista de aparelhos sem barco.`, action: 'Desvincular', input, done});
      else if (note) confirm({title: device ? 'Trocar o aparelho?' : 'Mover o aparelho?', message: `${boat.name} passa a usar o aparelho ${code}.${note}`, action: device ? 'Trocar' : 'Mover', input, done});
      else void mutate(input, done);
    };
    return <li key={boat.id}>
      <button className="adm-row" aria-expanded={editing === boat.id} onClick={() => open(editing === boat.id ? null : boat.id)}>
        <TeamBadge team={boat} />
        <span className="adm-row-main"><strong>{boat.name}</strong><small>{device ? <><code>{device.display_code}</code> · {seen(device)}</> : 'Sem aparelho'}</small></span>
        {trip && <span className="adm-tag on">Em viagem</span>}
        <span className="adm-chevron" aria-hidden="true">›</span>
      </button>
      {editing === boat.id && <form className="adm-edit" onSubmit={save}>
        <label className="adm-field"><span>Nome</span><input name="name" defaultValue={boat.name} maxLength={60} required autoComplete="off" /></label>
        {!isRegisteredHere(boat) && <p className="adm-hint">O nome muda também no app (resultados, fantasy e chat).</p>}
        <label className="adm-field"><span>ID do aparelho</span><input name="code" defaultValue={device?.display_code ?? ''} placeholder="Sem aparelho" maxLength={11} autoComplete="off" autoCapitalize="characters" spellCheck={false} className="adm-code" /></label>
        <p className="adm-hint">{device ? 'Troque o ID para passar o barco a outro aparelho, ou apague para desvincular.' : 'O código de 10 caracteres mostrado no aparelho com o DSB Tracker.'}</p>
        {trip && <button type="button" className="adm-button adm-wide" disabled={busy} onClick={() => endTrip(device, boat)}>Encerrar viagem</button>}
        <fieldset className="adm-colors"><legend>Cor no mapa</legend>
          {TEAM_COLORS.map(({hex, label}) => {
            // Colours already on another boat are marked, so each boat can keep its own.
            const taken = teams.filter(t => t.id !== boat.id && colorOf(t) === hex).map(t => t.name);
            return <label key={hex} title={taken.length ? `${label} · já usada por ${taken.join(', ')}` : label} className={taken.length ? 'taken' : undefined}><input type="radio" name="color" value={hex} defaultChecked={colorOf(boat) === hex} /><span style={{background: hex}} /></label>;
          })}
        </fieldset>
        <div className="adm-two">
          <label className="adm-field"><span>Embarcação</span><select name="hull" value={draft} onChange={e => setHull(e.target.value)}>{HULLS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          {(draft === 'cat' || draft === 'mono') && <label className="adm-field"><span>Motores</span><select name="motors" defaultValue={String(motors)}><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></label>}
        </div>
        {draft !== (boat.boat_hull ?? 'cat') && (draft === 'jetski' || draft === 'support') && <p className="adm-hint">Continua no mapa ao vivo, mas sai da classificação e da escalação do app.</p>}
        <button className="adm-button primary adm-wide" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button>
        {isRegisteredHere(boat) && <button type="button" className="adm-button danger adm-wide" disabled={busy} onClick={() => confirm({title: `Excluir ${boat.name}?`, message: `${boat.name} sai da lista e do mapa, e os trajetos, posições e SOS dele são apagados. Não dá para desfazer.`, action: 'Excluir', danger: true, input: {action: 'deleteBoat', teamId: boat.id}, done: `${boat.name} excluído.`})}>Excluir barco</button>}
      </form>}
    </li>;
  };

  const spareRow = (device: Device) => {
    const before = team(device.team_id);
    const link = (teamId: string) => {
      const owner = team(teamId);
      if (!owner) return;
      confirm({title: deviceOf(teamId) ? 'Trocar o aparelho?' : 'Vincular aparelho?', message: `O aparelho ${device.display_code} passa a enviar as posições de ${owner.name}.${swapNote(owner, device.display_code)}`, action: deviceOf(teamId) ? 'Trocar' : 'Vincular', input: {action: 'bind', code: device.display_code, teamId}});
    };
    return <li key={device.id} className="adm-row adm-device">
      <span className="adm-row-main"><strong><code>{device.display_code}</code></strong><small>{seen(device)}{before ? ` · antes em ${before.name}` : ''}</small></span>
      <span className="adm-row-actions">
        {onTrip.has(device.id) && <button className="adm-button small" disabled={busy} onClick={() => endTrip(device, before)}>Encerrar viagem</button>}
        <select className="adm-pick" value="" disabled={busy} aria-label={`Vincular o aparelho ${device.display_code} a um barco`} onChange={e => link(e.target.value)}>
          <option value="" disabled>Vincular a…</option>
          {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <button className="adm-icon danger" disabled={busy} aria-label={`Apagar aparelho ${device.display_code}`} onClick={() => confirm({title: 'Apagar aparelho?', message: `O aparelho ${device.display_code} sai da lista.${before ? ` O histórico de ${before.name} continua guardado.` : ''}`, action: 'Apagar', danger: true, input: {action: 'delete', id: device.id}})}>🗑</button>
      </span>
    </li>;
  };

  const competitors = teams.filter(t => !isCraft(t)), craft = teams.filter(isCraft);
  return <div className="adm-stack">
    <p className="adm-hint">Toque em um barco para mudar o nome, o aparelho (ID) e como ele aparece no mapa.</p>
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
        <p className="adm-hint">Aparelhos que abriram o DSB Tracker e não estão em nenhum barco. Para usar um deles, escolha o barco ao lado ou digite o ID no barco.</p>
        <ul className="adm-card adm-list">{spare.map(spareRow)}</ul>
        {spare.length > 1 && <button className="adm-button danger adm-wide" disabled={busy} onClick={() => confirm({title: `Apagar ${spare.length} aparelhos?`, message: 'Todos os aparelhos sem barco saem da lista. O histórico dos barcos (trajetos, posições e SOS) continua guardado. Aparelhos numa viagem em andamento não são apagados.', action: 'Apagar todos', danger: true, input: {action: 'deleteMany', ids: spare.slice(0, 200).map(d => d.id)}})}>Apagar os {spare.length} aparelhos sem barco</button>}
      </>}
    </>}
  </div>;
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
