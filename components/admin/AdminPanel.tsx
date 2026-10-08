'use client';
import { useCallback, useEffect, useState } from 'react';
import { adminFetch, hasAdminSession, insideApp, loginWithApp, loginWithPassword, logout } from '@/lib/tracker/admin-session';
import { logoUrl } from '@/lib/map/logos';
import { positionAge } from '@/lib/tracker/freshness';
import './admin.css';

type Team = {id: string; name: string; initials: string; color?: string; logo?: string | null; boat_hull?: string; boat_motors?: number};
type Device = {id: string; display_code: string; team_id: string | null; enabled: boolean; created_at: string; last_seen_at: string | null};
type Alert = {id: string; team_id: string; status: string; received_at: string};
type Overview = {teams: Team[]; devices: Device[]; alerts: Alert[]};
type Tab = 'course' | 'boats' | 'devices' | 'sos';
type Confirm = {title: string; message: string; action: string; danger?: boolean; input: Record<string, unknown>};

const COLORS: [string, string, string][] = [['blue', 'Azul', '#2f86ff'], ['green', 'Verde-limão', '#7bd63a'], ['gold', 'Amarelo', '#ffc629'], ['orange', 'Laranja', '#ff7a1f'], ['purple', 'Roxo', '#a371ff'], ['cyan', 'Ciano', '#41d6f5']];
const colorOf = (id?: string) => COLORS.find(c => c[0] === id)?.[2] ?? '#2f86ff';
const byName = (a: Team, b: Team) => a.name.localeCompare(b.name, 'pt-BR');

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
  return <span className="adm-badge" style={{width: size, height: size, '--team': colorOf(team?.color)} as React.CSSProperties}>
    {/* Small remote team logos: no next/image optimisation needed. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {logo ? <img src={logo} alt="" loading="lazy" /> : <b>{team?.initials ?? '—'}</b>}
  </span>;
}

/**
 * Organization panel: the race on the map, boats, tracker phones and SOS. On the map it is a sheet
 * (bottom on phones, side on large screens); at /admin it is the whole page.
 */
export function AdminPanel({mode, onClose, onSignedIn, course}: {mode: 'sheet' | 'page'; onClose?: () => void; onSignedIn?: () => void; course?: CourseControls}) {
  const [state, setState] = useState<'checking' | 'out' | 'in'>('checking');
  const [loginError, setLoginError] = useState('');
  const [tab, setTab] = useState<Tab>(course ? 'course' : 'devices');
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [editingTeam, setEditingTeam] = useState<string | null>(null);
  const app = insideApp();

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
  const tabs: [Tab, string][] = [...(course ? [['course', 'Prova'] as [Tab, string]] : []), ['boats', 'Barcos'], ['devices', 'Aparelhos'], ['sos', openAlerts ? `SOS · ${openAlerts}` : 'SOS']];

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
        : tab === 'boats' ? <BoatsTab teams={teams} editing={editingTeam} setEditing={setEditingTeam} busy={busy} mutate={mutate} />
        : tab === 'devices' ? <DevicesTab teams={teams} devices={data.devices} team={team} busy={busy} confirm={setConfirm} />
        : <SosTab alerts={data.alerts} team={team} busy={busy} confirm={setConfirm} />}
    </>;

  return <section className={`dsb-admin dsb-admin--${mode}`} aria-label="Painel da organização">
    <header className="adm-head">
      <div><span className="adm-eyebrow">DESAFIO SOLAR BRASIL</span><h1>Organização</h1></div>
      <div className="adm-head-actions">
        {state === 'in' && !app && <button className="adm-button ghost" onClick={() => { void logout(); setState('out'); setData(null); }}>Sair</button>}
        {onClose && <button className="adm-icon" onClick={onClose} aria-label="Fechar painel">×</button>}
      </div>
    </header>
    <div className="adm-body">{body}</div>
    {confirm && <div className="adm-overlay" onClick={() => !busy && setConfirm(null)}>
      <div className="adm-dialog" role="dialog" aria-modal="true" aria-labelledby="adm-confirm" onClick={e => e.stopPropagation()}>
        <h2 id="adm-confirm">{confirm.title}</h2><p>{confirm.message}</p>
        <div className="adm-dialog-actions">
          <button className="adm-button" disabled={busy} onClick={() => setConfirm(null)}>Cancelar</button>
          <button autoFocus className={`adm-button ${confirm.danger ? 'danger-solid' : 'primary'}`} disabled={busy} onClick={() => void mutate(confirm.input)}>{busy ? 'Salvando…' : confirm.action}</button>
        </div>
      </div>
    </div>}
  </section>;
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

function BoatsTab({teams, editing, setEditing, busy, mutate}: {teams: Team[]; editing: string | null; setEditing: (id: string | null) => void; busy: boolean; mutate: (input: Record<string, unknown>, done?: string) => Promise<void>}) {
  const [adding, setAdding] = useState(false);
  return <div className="adm-stack">
    <p className="adm-hint">As equipes do Desafio Solar. Toque em um barco para mudar como ele aparece no mapa.</p>
    <ul className="adm-card adm-list">
      {teams.map(team => <li key={team.id}>
        <button className="adm-row" aria-expanded={editing === team.id} onClick={() => setEditing(editing === team.id ? null : team.id)}>
          <TeamBadge team={team} />
          <span className="adm-row-main"><strong>{team.name}</strong><small>{team.boat_hull === 'mono' ? 'Monocasco' : 'Catamarã'} · {team.boat_motors ?? 1} {(team.boat_motors ?? 1) > 1 ? 'motores' : 'motor'}</small></span>
          <span className="adm-swatch" style={{background: colorOf(team.color)}} aria-label={COLORS.find(c => c[0] === team.color)?.[1]} />
        </button>
        {editing === team.id && <form className="adm-edit" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void mutate({action: 'style', teamId: team.id, color: form.get('color'), hull: form.get('hull'), motors: Number(form.get('motors'))}, `${team.name} atualizado no mapa.`); }}>
          <fieldset className="adm-colors"><legend>Cor no mapa</legend>
            {COLORS.map(([id, label, hex]) => <label key={id} title={label}><input type="radio" name="color" value={id} defaultChecked={(team.color ?? 'blue') === id} /><span style={{background: hex}} /></label>)}
          </fieldset>
          <div className="adm-two">
            <label className="adm-field"><span>Casco</span><select name="hull" defaultValue={team.boat_hull ?? 'cat'}><option value="cat">Catamarã</option><option value="mono">Monocasco</option></select></label>
            <label className="adm-field"><span>Motores</span><select name="motors" defaultValue={String(team.boat_motors ?? 1)}><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></label>
          </div>
          <button className="adm-button primary adm-wide" disabled={busy}>{busy ? 'Salvando…' : 'Salvar aparência'}</button>
        </form>}
      </li>)}
    </ul>
    {adding ? <form className="adm-card adm-pad adm-form" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void mutate({action: 'createBoat', name: form.get('name'), initials: form.get('initials')}, 'Barco cadastrado.').then(() => setAdding(false)); }}>
      <h3>Novo barco</h3>
      <div className="adm-two">
        <label className="adm-field"><span>Nome</span><input name="name" placeholder="Nome da equipe" maxLength={60} required autoFocus /></label>
        <label className="adm-field adm-narrow"><span>Sigla</span><input name="initials" placeholder="SOL" maxLength={3} required /></label>
      </div>
      <div className="adm-dialog-actions"><button type="button" className="adm-button" onClick={() => setAdding(false)}>Cancelar</button><button className="adm-button primary" disabled={busy}>Cadastrar</button></div>
    </form> : <button className="adm-button adm-wide" onClick={() => setAdding(true)}>＋ Cadastrar barco</button>}
  </div>;
}

function DevicesTab({teams, devices, team, busy, confirm}: {teams: Team[]; devices: Device[]; team: (id: string | null) => Team | undefined; busy: boolean; confirm: (c: Confirm) => void}) {
  const [teamId, setTeamId] = useState('');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const inUse = devices.filter(d => d.enabled && d.team_id).sort((a, b) => (team(a.team_id)?.name ?? '').localeCompare(team(b.team_id)?.name ?? '', 'pt-BR'));
  const others = devices.filter(d => !(d.enabled && d.team_id));
  const current = devices.find(d => d.enabled && d.team_id === teamId);
  // Only phones that still exist count (the list refreshes every few seconds).
  const selected = devices.filter(d => chosen.has(d.id)).map(d => d.id);
  const toggle = (id: string) => setChosen(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const toggleAll = (list: Device[]) => setChosen(prev => {
    const next = new Set(prev), all = list.every(d => next.has(d.id));
    for (const d of list) if (all) next.delete(d.id); else next.add(d.id);
    return next;
  });
  const heading = (label: string, list: Device[]) => <h3 className="adm-section">{label} <small>{list.length}</small>
    {list.length > 1 && <button className="adm-link" onClick={() => toggleAll(list)}>{list.every(d => chosen.has(d.id)) ? 'Desmarcar todos' : 'Selecionar todos'}</button>}
  </h3>;
  const row = (device: Device) => {
    const owner = team(device.team_id), seen = device.last_seen_at ? positionAge(device.last_seen_at) : 'Nunca conectou';
    return <li key={device.id} className={`adm-row adm-device ${chosen.has(device.id) ? 'adm-chosen' : ''}`}>
      <label className="adm-check" aria-label={`Selecionar aparelho ${device.display_code}`}><input type="checkbox" checked={chosen.has(device.id)} onChange={() => toggle(device.id)} /></label>
      <TeamBadge team={owner} size={36} />
      <span className="adm-row-main"><strong>{owner?.name ?? 'Sem barco'}</strong><small><code>{device.display_code}</code> · {seen}</small></span>
      <span className={`adm-tag ${device.enabled ? 'on' : ''}`}>{device.enabled ? 'Em uso' : 'Desativado'}</span>
      <span className="adm-row-actions">
        {device.enabled && <button className="adm-button small" disabled={busy} onClick={() => confirm({title: 'Desativar aparelho?', message: `O aparelho ${device.display_code} deixa de enviar posições${owner ? ` de ${owner.name}` : ''}.`, action: 'Desativar', input: {action: 'disable', id: device.id}})}>Desativar</button>}
        <button className="adm-icon danger" disabled={busy} aria-label={`Apagar aparelho ${device.display_code}`} onClick={() => confirm({title: 'Apagar aparelho?', message: `O aparelho ${device.display_code} sai da lista.${owner ? ` O histórico de ${owner.name} continua guardado.` : ''}`, action: 'Apagar', danger: true, input: {action: 'delete', id: device.id}})}>🗑</button>
      </span>
    </li>;
  };
  return <div className="adm-stack">
    <form className="adm-card adm-pad adm-form" onSubmit={event => {
      event.preventDefault(); const form = new FormData(event.currentTarget); const owner = team(String(form.get('teamId')));
      confirm({title: current ? 'Trocar o aparelho?' : 'Vincular aparelho?', message: current ? `${owner?.name} passa a usar o aparelho ${form.get('code')}. O aparelho ${current.display_code} é desativado; o barco continua o mesmo no mapa e no histórico.` : `O aparelho ${form.get('code')} passa a enviar as posições de ${owner?.name}.`, action: current ? 'Trocar' : 'Vincular', input: {action: 'bind', code: form.get('code'), teamId: form.get('teamId')}});
    }}>
      <h3>Vincular aparelho a um barco</h3>
      <div className="adm-two adm-two--wide">
        <label className="adm-field"><span>Barco</span><select name="teamId" required value={teamId} onChange={e => setTeamId(e.target.value)}><option value="" disabled>Selecione o barco</option>{teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        <label className="adm-field"><span>Código mostrado no celular</span><input name="code" placeholder="838AA42633" maxLength={11} autoComplete="off" required className="adm-code" /></label>
      </div>
      {current && <p className="adm-hint">{team(teamId)?.name} usa hoje o aparelho <code>{current.display_code}</code>. Ele será trocado pelo novo.</p>}
      <button className="adm-button primary adm-wide" disabled={busy}>{current ? 'Trocar aparelho' : 'Vincular aparelho'}</button>
    </form>
    {heading('Em uso', inUse)}
    {inUse.length ? <ul className="adm-card adm-list">{inUse.map(row)}</ul> : <p className="adm-note">Nenhum aparelho em uso.</p>}
    {others.length > 0 && <>{heading('Outros aparelhos', others)}<ul className="adm-card adm-list">{others.map(row)}</ul></>}
    {selected.length > 0 && <div className="adm-bulk" role="region" aria-label="Aparelhos selecionados">
      <span><strong>{selected.length}</strong> {selected.length === 1 ? 'selecionado' : 'selecionados'}</span>
      <button className="adm-button ghost" onClick={() => setChosen(new Set())}>Limpar</button>
      <button className="adm-button danger-solid" disabled={busy} onClick={() => confirm({title: `Apagar ${selected.length} ${selected.length === 1 ? 'aparelho' : 'aparelhos'}?`, message: 'Eles saem da lista. O histórico dos barcos (trajetos, posições e SOS) continua guardado. Aparelhos numa viagem em andamento não são apagados.', action: 'Apagar', danger: true, input: {action: 'deleteMany', ids: selected}})}>Apagar {selected.length}</button>
    </div>}
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
