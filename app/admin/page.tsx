'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import './tracker-admin.css';

type Team={id:string;name:string;initials:string;color?:string;boat_hull?:string;boat_motors?:number};
const COLORS:[string,string,string][]=[['blue','Azul','#2f86ff'],['green','Verde-limão','#7bd63a'],['gold','Amarelo','#ffc629'],['orange','Laranja','#ff7a1f'],['purple','Roxo','#a371ff'],['cyan','Ciano','#41d6f5']];
type Device={id:string;display_code:string;team_id:string|null;enabled:boolean;last_seen_at:string|null};
type Alert={id:string;team_id:string;status:string;received_at:string;lat_e7:number|null;lon_e7:number|null};
type Overview={teams:Team[];devices:Device[];alerts:Alert[]};
export default function Admin() {
  const [authorized,setAuthorized]=useState(false); const [ready,setReady]=useState(false);
  const [overview,setOverview]=useState<Overview|null>(null); const [error,setError]=useState(''); const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false); const [confirmation,setConfirmation]=useState<{title:string;message:string;input:Record<string,unknown>}|null>(null);
  const refresh=useCallback(async()=>{
    const response=await fetch('/api/admin/tracker',{cache:'no-store'}); const result=await response.json();
    if(!response.ok) { if(response.status===401) setAuthorized(false); throw Error(result.error); }
    setOverview(result);
  },[]);
  useEffect(()=>{
    let disposed=false;
    fetch('/api/admin/session',{cache:'no-store'}).then(async response=>{
      if(disposed) return; setAuthorized(response.ok); setReady(true);
      if(response.ok) await refresh();
    }).catch(()=>{ if(!disposed) {setReady(true);setError('Não foi possível conectar.');} });
    return()=>{disposed=true;};
  },[refresh]);
  useEffect(()=>{
    if(!authorized) return;
    let active=true; let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{try {if(!document.hidden) await refresh();} catch(e){if(active) setError((e as Error).message);} finally{if(active) timer=setTimeout(poll,3000);} };
    timer=setTimeout(poll,3000);
    const session=setInterval(()=>{fetch('/api/admin/session').catch(()=>{});},20*60*1000);
    return()=>{active=false;clearTimeout(timer);clearInterval(session);};
  },[authorized,refresh]);
  async function login(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true);setError(''); const form=new FormData(event.currentTarget);
    try {const response=await fetch('/api/admin/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:form.get('password')})}); const data=await response.json(); if(!response.ok) throw Error(data.error);setAuthorized(true);await refresh();}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function mutate(input:Record<string,unknown>) {
    setBusy(true);setError('');setNotice('');
    try {const response=await fetch('/api/admin/tracker',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}); const result=await response.json();if(!response.ok) throw Error(result.error); await refresh();setNotice('Alteração salva.');setConfirmation(null);}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  const teamName=(id:string|null)=>overview?.teams.find(t=>t.id===id)?.name??'Sem barco';
  return <main className="tracker-admin">
    <header className="ta-header"><Link href="/">◉ DSB <span>Rastreamento</span></Link><div><Link href="/">Abrir mapa ↗</Link>{authorized&&<button onClick={async()=>{await fetch('/api/admin/session',{method:'DELETE'});setAuthorized(false);setOverview(null);}}>Sair</button>}</div></header>
    <section className="ta-intro"><p className="ta-eyebrow">ORGANIZAÇÃO DA PROVA</p><h1>Barcos conectados.</h1><p>Autorize os aparelhos e acompanhe os pedidos de apoio.</p></section>
    {error&&<div className="ta-message ta-error" role="alert">{error}<button onClick={()=>setError('')} aria-label="Fechar erro">×</button></div>}
    {notice&&<div className="ta-message" role="status">{notice}</div>}
    {!ready?<p>Conectando…</p>:!authorized?<form className="ta-card ta-login" onSubmit={login}><h2>Acesso da organização</h2><p>Informe a senha da organização.</p><label>Senha<input type="password" name="password" autoComplete="current-password" required autoFocus/></label><button className="ta-primary" disabled={busy}>{busy?'Entrando…':'Entrar'}</button></form>:overview&&<>
      {overview.alerts.length>0&&<section className="ta-alerts"><h2>Pedidos de apoio <span>{overview.alerts.length}</span></h2>{overview.alerts.map(alert=><article className="ta-card ta-sos" key={alert.id}><div><p className="ta-eyebrow">{alert.status==='acknowledged'?'APOIO A CAMINHO':'SOS RECEBIDO'}</p><h3>{teamName(alert.team_id)}</h3><p>{new Date(alert.received_at).toLocaleTimeString('pt-BR')}</p></div><div className="ta-actions"><Link href={`/?boat=${encodeURIComponent(alert.team_id)}`}>Ver no mapa ↗</Link>{alert.status==='open'&&<button className="ta-danger" disabled={busy} onClick={()=>setConfirmation({title:'Apoio a caminho?',message:'Confirme somente após acionar a equipe. O piloto receberá essa confirmação.',input:{action:'sos',id:alert.id,status:'acknowledged'}})}>Confirmar atendimento</button>}<button disabled={busy} onClick={()=>setConfirmation({title:'Encerrar este SOS?',message:'O pedido será encerrado e o piloto poderá abrir um novo SOS.',input:{action:'sos',id:alert.id,status:'resolved'}})}>Encerrar chamado</button></div></article>)}</section>}
      <div className="ta-columns"><form className="ta-card" onSubmit={event=>{event.preventDefault();const form=new FormData(event.currentTarget);setConfirmation({title:'Autorizar este aparelho?',message:`Código ${form.get('code')} para ${teamName(String(form.get('teamId')))}.`,input:{action:'bind',code:form.get('code'),teamId:form.get('teamId')}});}}><p className="ta-eyebrow">01 · CONECTAR</p><h2>Vincular tracker</h2><label>Barco<select name="teamId" required defaultValue=""><option value="" disabled>Selecione o barco</option>{overview.teams.map(team=><option key={team.id} value={team.id}>{team.name}</option>)}</select></label><label>Código no celular<input name="code" placeholder="838AA42633" maxLength={11} autoComplete="off" required className="ta-code"/></label><p>Abra o app com internet para gerar o cadastro.</p><button className="ta-primary" disabled={busy}>Vincular aparelho</button></form>
      <form className="ta-card" onSubmit={event=>{event.preventDefault();const form=new FormData(event.currentTarget);void mutate({action:'createBoat',name:form.get('name'),initials:form.get('initials')});}}><p className="ta-eyebrow">02 · CADASTRAR</p><h2>Novo barco</h2><label>Nome<input name="name" placeholder="Nome da equipe" maxLength={60} required/></label><label>Sigla<input name="initials" placeholder="SOL" maxLength={3} required/></label><p>O barco também ficará cadastrado na base DSB.</p><button className="ta-secondary" disabled={busy}>Cadastrar barco</button></form></div>
      <section className="ta-card ta-looks"><div className="ta-section-heading"><h2>Aparência no mapa</h2><span>cor, casco e motores</span></div>
        {overview.teams.length===0?<p>Nenhum barco cadastrado.</p>:overview.teams.map(team=><form className="ta-look" key={team.id} onSubmit={event=>{event.preventDefault();const form=new FormData(event.currentTarget);void mutate({action:'style',teamId:team.id,color:form.get('color'),hull:form.get('hull'),motors:Number(form.get('motors'))});}}>
          <strong><span className="ta-swatch" style={{background:COLORS.find(c=>c[0]===team.color)?.[2]??'#2f86ff'}}/>{team.name}</strong>
          <label>Cor<select name="color" defaultValue={team.color??'blue'}>{COLORS.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
          <label>Casco<select name="hull" defaultValue={team.boat_hull??'cat'}><option value="cat">Catamarã</option><option value="mono">Monocasco</option></select></label>
          <label>Motores<select name="motors" defaultValue={String(team.boat_motors??1)}><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></label>
          <button disabled={busy}>Salvar</button>
        </form>)}
      </section>
      <section className="ta-card ta-devices"><div className="ta-section-heading"><h2>Aparelhos</h2><span>{overview.devices.length} cadastrados</span></div>{overview.devices.length===0?<p>Nenhum aparelho cadastrado ainda.</p>:overview.devices.map(device=><div className="ta-device" key={device.id}><div><strong>{teamName(device.team_id)}</strong><code>{device.display_code}</code></div><span className={device.enabled?'ta-badge active':'ta-badge'}>{device.enabled?'Autorizado':'Não autorizado'}</span>{device.enabled&&<button disabled={busy} onClick={()=>setConfirmation({title:'Desativar tracker?',message:`O aparelho de ${teamName(device.team_id)} deixará de enviar posições.`,input:{action:'disable',id:device.id}})}>Desativar</button>}</div>)}</section>
    </>}
    {confirmation&&<div className="ta-overlay"><section className="ta-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><span className="ta-modal-icon">◉</span><h2 id="confirm-title">{confirmation.title}</h2><p>{confirmation.message}</p><button autoFocus className="ta-primary" disabled={busy} onClick={()=>void mutate(confirmation.input)}>{busy?'Salvando…':'Confirmar'}</button><button disabled={busy} onClick={()=>setConfirmation(null)}>Cancelar</button></section></div>}
  </main>;
}
