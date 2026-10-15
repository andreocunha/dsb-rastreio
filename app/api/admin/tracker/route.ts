import { ApiError, database, operator, sameOrigin, body, json, failure } from '@/lib/tracker/server';
import { isTeamColor } from '@/lib/map/team-colors';

// Competitors are catamarans or monohulls; the rescue jet ski and the support boat are tracked
// like any boat but stay out of the competition (team_standings leaves them out).
const HULLS=['cat','mono','jetski','support'];
// Before the support-craft migration the database only takes 'cat' and 'mono'.
const missingMigration=(code?:string)=>code==='42703'||code==='PGRST204'||code==='23514';

type Database=ReturnType<typeof database>;
/** Deletes a tracker phone. The boat keeps its trips, positions and SOS history: only the link to this phone goes. */
async function deleteDevice(db:Database,id:string) {
  const open=await db.from('tracker_sessions').select('id',{count:'exact',head:true}).eq('device_id',id).is('ended_at',null);
  if(open.error) throw new ApiError(503,'Não foi possível conferir o aparelho.');
  if(open.count) throw new ApiError(409,'Este aparelho está numa viagem em andamento. Encerre a viagem antes de apagar.');
  for(const table of ['tracker_sos','tracker_points','tracker_sessions']) {
    const unlinked=await db.from(table).update({device_id:null}).eq('device_id',id);
    if(unlinked.error) throw new ApiError(503,'Não foi possível apagar o aparelho.');
  }
  // Only its last live position (a per-phone cache) goes with it.
  const latest=await db.from('tracker_latest').delete().eq('device_id',id);
  if(latest.error) throw new ApiError(503,'Não foi possível apagar o aparelho.');
  const removed=await db.from('tracker_devices').delete().eq('id',id).select('id').single();
  if(removed.error) throw new ApiError(400,'Não foi possível apagar o aparelho.');
}
/**
 * Deletes a boat registered in this panel (trk- id), with its trips, positions and SOS history.
 * The competition teams come from the DSB app (accounts, results, fantasy) and are not deleted here.
 */
async function deleteBoat(db:Database,id:string) {
  const linked=await db.from('tracker_devices').select('id',{count:'exact',head:true}).eq('team_id',id).eq('enabled',true);
  if(linked.error) throw new ApiError(503,'Não foi possível conferir o barco.');
  if(linked.count) throw new ApiError(409,'Este barco tem aparelho vinculado. Apague o ID do aparelho e salve antes de excluir o barco.');
  // Results cascade with the team row: a boat that already scored stays.
  for(const table of ['race_laps','penalties','race_status']) {
    const scored=await db.from(table).select('team_id',{count:'exact',head:true}).eq('team_id',id);
    if(scored.error) throw new ApiError(503,'Não foi possível conferir o barco.');
    if(scored.count) throw new ApiError(409,'Este barco tem resultados lançados na competição e não pode ser excluído.');
  }
  for(const table of ['tracker_latest','tracker_sos','tracker_points','tracker_sessions']) {
    const cleared=await db.from(table).delete().eq('team_id',id);
    if(cleared.error) throw new ApiError(503,'Não foi possível excluir o barco.');
  }
  // Phones this boat used before (already unlinked) stay in the list, without a boat.
  const freed=await db.from('tracker_devices').update({team_id:null}).eq('team_id',id).eq('enabled',false);
  if(freed.error) throw new ApiError(503,'Não foi possível excluir o barco.');
  const removed=await db.from('teams').delete().eq('id',id).select('id').single();
  if(removed.error) throw new ApiError(400,'Não foi possível excluir o barco.');
}
/** Retires the phone a boat is using: its open trip is closed and it stops sending that boat's positions. */
async function unlinkDevices(db:Database,teamId:string,exceptCode='') {
  const previous=await db.from('tracker_devices').select('id').eq('team_id',teamId).eq('enabled',true).neq('display_code',exceptCode);
  if(previous.error) throw new ApiError(503,'Não foi possível conferir o aparelho atual do barco.');
  for(const old of previous.data) {
    const ended=await db.from('tracker_sessions').update({ended_at:new Date().toISOString()}).eq('device_id',old.id).is('ended_at',null);
    const disabled=await db.from('tracker_devices').update({enabled:false}).eq('id',old.id);
    if(ended.error || disabled.error) throw new ApiError(503,'Não foi possível retirar o aparelho anterior.');
  }
}
/**
 * Links a phone to a boat. Positions belong to the boat, not the phone: linking a new phone to a
 * boat that already has one swaps them (the boat keeps its name, colour and history on the map).
 */
async function bindDevice(db:Database,code:string,teamId:string) {
  // Checked first, so a mistyped code (or a phone busy on another boat) does not leave this boat
  // without its current phone.
  const found=await db.from('tracker_devices').select('id,team_id').eq('display_code',code).maybeSingle();
  if(found.error) throw new ApiError(503,'Não foi possível conferir o aparelho.');
  if(!found.data) throw new ApiError(404,'ID de aparelho não encontrado. Abra o DSB Tracker com internet no aparelho primeiro.');
  if(found.data.team_id!==teamId) {
    const open=await db.from('tracker_sessions').select('id',{count:'exact',head:true}).eq('device_id',found.data.id).is('ended_at',null);
    if(open.error) throw new ApiError(503,'Não foi possível conferir o aparelho.');
    if(open.count) throw new ApiError(409,'Este aparelho está numa viagem de outro barco. Encerre a viagem antes de trocar de barco.');
  }
  await unlinkDevices(db,teamId,code);
  const result=await db.rpc('tracker_bind_device',{p_code:code,p_team:teamId});
  if(result.error) {
    if(result.error.code==='23505') throw new ApiError(409,'Este barco já tem um tracker. Desative o anterior primeiro.');
    if(result.error.message.includes('device_not_found')) throw new ApiError(404,'ID de aparelho não encontrado. Abra o DSB Tracker com internet no aparelho primeiro.');
    if(result.error.message.includes('device_has_active_trip')) throw new ApiError(409,'Este aparelho está numa viagem de outro barco. Encerre a viagem antes de trocar de barco.');
    throw new ApiError(400,'Não foi possível vincular este aparelho.');
  }
}
/**
 * Leaves a phone ready on a boat without turning it on: a spare (team_id set, enabled false). It
 * sends nothing until the organizer activates it, so two phones never track the same boat at once.
 */
async function addSpare(db:Database,code:string,teamId:string) {
  const found=await db.from('tracker_devices').select('id,team_id,enabled').eq('display_code',code).maybeSingle();
  if(found.error) throw new ApiError(503,'Não foi possível conferir o aparelho.');
  if(!found.data) throw new ApiError(404,'ID de aparelho não encontrado. Abra o DSB Tracker com internet no aparelho primeiro.');
  if(found.data.enabled) throw new ApiError(409,found.data.team_id===teamId?'Este já é o aparelho ativo do barco.':'Este aparelho está ativo em outro barco. Desative ele lá primeiro.');
  const saved=await db.from('tracker_devices').update({team_id:teamId}).eq('id',found.data.id).eq('enabled',false).select('id').single();
  if(saved.error) throw new ApiError(400,'Não foi possível adicionar o aparelho.');
}
const deviceCode=(value:unknown)=>String(value??'').replace(/\s/g,'').toUpperCase();
const isDeviceCode=(code:string)=>/^[A-F0-9]{10}$/.test(code);

export async function GET() {
  try {
    await operator(); const db=database();
    const [teams,devices,alerts,trips]=await Promise.all([
      db.from('teams').select('*').eq('active',true).order('name'),
      db.from('tracker_devices').select('id,display_code,team_id,enabled,created_at,last_seen_at').order('created_at',{ascending:false}),
      db.from('tracker_sos').select('id,team_id,status,triggered_at,received_at,lat_e7,lon_e7').neq('status','resolved').order('received_at',{ascending:false}).limit(100),
      db.from('tracker_sessions').select('device_id').is('ended_at',null).not('device_id','is',null).limit(500),
    ]);
    if(teams.error || devices.error || alerts.error || trips.error) throw new ApiError(503,'Não foi possível carregar a organização.');
    // Aparelhos com viagem aberta: mostram "Encerrar viagem" no painel.
    const onTrip=[...new Set(trips.data.map(t=>t.device_id as string))];
    return json({teams:teams.data,devices:devices.data,alerts:alerts.data,onTrip});
  } catch(error) { return failure(error); }
}
export async function POST(request:Request) {
  try {
    sameOrigin(request); await operator(); const input=await body(request,16384); const db=database();
    if(input.action==='bind') {
      const code=deviceCode(input.code); const teamId=String(input.teamId??'');
      if(!isDeviceCode(code) || !teamId || teamId.length>100) throw new ApiError(400,'Confira o ID de 10 caracteres e o barco.');
      await bindDevice(db,code,teamId);
    } else if(input.action==='addSpare') {
      const code=deviceCode(input.code); const teamId=String(input.teamId??'');
      if(!isDeviceCode(code) || !teamId || teamId.length>100) throw new ApiError(400,'O ID do aparelho tem 10 caracteres (números e letras de A a F).');
      await addSpare(db,code,teamId);
    } else if(input.action==='removeSpare') {
      // The spare leaves the boat and goes back to the phones without a boat.
      if(typeof input.id!=='string' || input.id.length>100) throw new ApiError(400,'Aparelho inválido.');
      const result=await db.from('tracker_devices').update({team_id:null}).eq('id',input.id).eq('enabled',false).select('id').single();
      if(result.error) throw new ApiError(400,'Não foi possível remover o aparelho.');
    } else if(input.action==='deactivate') {
      // The boat's active phone becomes a spare: its trip closes and it stops sending positions.
      const teamId=String(input.teamId??'');
      if(!teamId || teamId.length>100) throw new ApiError(400,'Barco inválido.');
      await unlinkDevices(db,teamId);
    } else if(input.action==='saveBoat') {
      // The whole boat in one save: name, map appearance (colour, hull form, outboard count) and its
      // phone. teams.color stays the DSB app's badge; the map colour lives in map_color (unchanged
      // when none is picked). `code` only comes when the phone changed: empty unlinks it.
      const teamId=String(input.teamId??''),name=String(input.name??'').trim(),color=input.color==null||input.color===''?null:input.color,hull=String(input.hull??''),motors=Number(input.motors);
      const code=input.code===undefined?null:deviceCode(input.code);
      if(!teamId || teamId.length>100) throw new ApiError(400,'Barco inválido.');
      if(name.length<2 || name.length>60) throw new ApiError(400,'O nome precisa ter de 2 a 60 caracteres.');
      if((color!==null && !isTeamColor(color)) || !HULLS.includes(hull) || ![1,2,3].includes(motors)) throw new ApiError(400,'Aparência inválida.');
      if(code && !isDeviceCode(code)) throw new ApiError(400,'O ID do aparelho tem 10 caracteres (números e letras de A a F).');
      // The phone first: when its ID is wrong, nothing is saved and the form stays as typed.
      if(code) await bindDevice(db,code,teamId); else if(code==='') await unlinkDevices(db,teamId);
      const result=await db.from('teams').update({name,...(color?{map_color:color}:{}),boat_hull:hull,boat_motors:motors}).eq('id',teamId).select('id').single();
      if(result.error) throw new ApiError(missingMigration(result.error.code)?503:400,missingMigration(result.error.code)?'Aplique a migração de cores no mapa no banco.':'Não foi possível salvar o barco.');
    } else if(input.action==='disable') {
      if(typeof input.id!=='string') throw new ApiError(400,'Aparelho inválido.');
      const result=await db.from('tracker_devices').update({enabled:false}).eq('id',input.id).select('id').single();
      if(result.error) throw new ApiError(400,'Não foi possível desativar.');
    } else if(input.action==='endTrip') {
      // Fecha a viagem aberta do aparelho: o barco sai do mapa ao vivo depois de 1 h; o histórico fica guardado.
      if(typeof input.id!=='string' || input.id.length>100) throw new ApiError(400,'Aparelho inválido.');
      const result=await db.from('tracker_sessions').update({ended_at:new Date().toISOString()}).eq('device_id',input.id).is('ended_at',null);
      if(result.error) throw new ApiError(503,'Não foi possível encerrar a viagem.');
    } else if(input.action==='delete') {
      if(typeof input.id!=='string' || input.id.length>100) throw new ApiError(400,'Aparelho inválido.');
      await deleteDevice(db,input.id);
    } else if(input.action==='deleteMany') {
      // Several at once (old test phones). Each is checked like a single delete; the ones on a trip stay.
      const ids=Array.isArray(input.ids)?input.ids.filter((id:unknown)=>typeof id==='string' && id.length<=100):[];
      if(!ids.length || ids.length>5000) throw new ApiError(400,'Selecione os aparelhos.');
      let deleted=0; const kept:string[]=[];
      for(const id of ids) {
        try { await deleteDevice(db,id); deleted++; }
        catch(error) { if(error instanceof ApiError && error.status===409) kept.push(id); else throw error; }
      }
      return json({ok:true,deleted,kept});
    } else if(input.action==='createBoat') {
      const name=String(input.name??'').trim(); const initials=String(input.initials??'').trim().toUpperCase(); const hull=String(input.hull??'cat');
      if(name.length<2 || name.length>60 || !/^[A-Z0-9À-Ÿ]{1,3}$/.test(initials)) throw new ApiError(400,'Informe nome e sigla de até 3 caracteres.');
      if(!HULLS.includes(hull)) throw new ApiError(400,'Tipo de embarcação inválido.');
      const id=`trk-${crypto.randomUUID().replaceAll('-','')}`;
      const result=await db.from('teams').insert({id,name,initials,color:'blue',university:'',...(hull==='cat'?{}:{boat_hull:hull})});
      if(result.error) throw new ApiError(missingMigration(result.error.code)?503:400,missingMigration(result.error.code)?'Aplique a migração de embarcações de apoio no banco.':'Não foi possível cadastrar o barco.');
    } else if(input.action==='deleteBoat') {
      const teamId=String(input.teamId??'');
      if(!/^trk-[a-f0-9]{32}$/.test(teamId)) throw new ApiError(400,'Só barcos cadastrados neste painel podem ser excluídos.');
      await deleteBoat(db,teamId);
    } else if(input.action==='style') {
      // Map appearance only: colour, hull form and outboard count. teams.color stays the DSB
      // app's badge; the map colour lives in map_color (unchanged when none is picked).
      const teamId=String(input.teamId??''),color=input.color==null||input.color===''?null:input.color,hull=String(input.hull??''),motors=Number(input.motors);
      if(!teamId || teamId.length>100 || (color!==null && !isTeamColor(color)) || !HULLS.includes(hull) || ![1,2,3].includes(motors)) throw new ApiError(400,'Aparência inválida.');
      const result=await db.from('teams').update({...(color?{map_color:color}:{}),boat_hull:hull,boat_motors:motors}).eq('id',teamId).select('id').single();
      if(result.error) throw new ApiError(missingMigration(result.error.code)?503:400,missingMigration(result.error.code)?'Aplique a migração de cores no mapa no banco.':'Não foi possível salvar a aparência.');
    } else if(input.action==='sos') {
      if(!['acknowledged','resolved'].includes(input.status) || typeof input.id!=='string') throw new ApiError(400,'Estado de SOS inválido.');
      const patch=input.status==='acknowledged' ? {status:input.status,acknowledged_at:new Date().toISOString()} : {status:input.status,resolved_at:new Date().toISOString()};
      const result=await db.from('tracker_sos').update(patch).eq('id',input.id).neq('status','resolved').select('id').single();
      if(result.error) throw new ApiError(409,'Este chamado já foi atualizado. Recarregue.');
    } else throw new ApiError(400,'Ação inválida.');
    return json({ok:true});
  } catch(error) { return failure(error); }
}
