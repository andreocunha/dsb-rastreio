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

export async function GET() {
  try {
    await operator(); const db=database();
    const [teams,devices,alerts,trips]=await Promise.all([
      db.from('teams').select('*').eq('active',true).order('name'),
      db.from('tracker_devices').select('id,display_code,team_id,enabled,created_at,last_seen_at').order('created_at',{ascending:false}).limit(500),
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
      const code=String(input.code??'').replace(/\s/g,'').toUpperCase(); const teamId=String(input.teamId??'');
      if(!/^[A-F0-9]{10}$/.test(code) || !teamId || teamId.length>100) throw new ApiError(400,'Confira o código de 10 caracteres e o barco.');
      // Positions belong to the boat, not the phone: linking a new phone to a boat that already has
      // one swaps them (the boat keeps its name, colour and history on the map). The old phone is
      // retired and its open trip closed.
      const previous=await db.from('tracker_devices').select('id').eq('team_id',teamId).eq('enabled',true).neq('display_code',code);
      if(previous.error) throw new ApiError(503,'Não foi possível conferir o aparelho atual do barco.');
      for(const old of previous.data) {
        const ended=await db.from('tracker_sessions').update({ended_at:new Date().toISOString()}).eq('device_id',old.id).is('ended_at',null);
        const disabled=await db.from('tracker_devices').update({enabled:false}).eq('id',old.id);
        if(ended.error || disabled.error) throw new ApiError(503,'Não foi possível retirar o aparelho anterior.');
      }
      const result=await db.rpc('tracker_bind_device',{p_code:code,p_team:teamId});
      if(result.error) {
        if(result.error.code==='23505') throw new ApiError(409,'Este barco já tem um tracker. Desative o anterior primeiro.');
        if(result.error.message.includes('device_not_found')) throw new ApiError(404,'Código não encontrado. Abra o app com internet primeiro.');
        if(result.error.message.includes('device_has_active_trip')) throw new ApiError(409,'Encerre a viagem antes de trocar de barco.');
        throw new ApiError(400,'Não foi possível vincular este aparelho.');
      }
    } else if(input.action==='disable') {
      if(typeof input.id!=='string') throw new ApiError(400,'Aparelho inválido.');
      const result=await db.from('tracker_devices').update({enabled:false}).eq('id',input.id).select('id').single();
      if(result.error) throw new ApiError(400,'Não foi possível desativar.');
    } else if(input.action==='endTrip') {
      // Fecha a viagem aberta do aparelho: o barco sai do mapa ao vivo; o histórico fica guardado.
      if(typeof input.id!=='string' || input.id.length>100) throw new ApiError(400,'Aparelho inválido.');
      const result=await db.from('tracker_sessions').update({ended_at:new Date().toISOString()}).eq('device_id',input.id).is('ended_at',null);
      if(result.error) throw new ApiError(503,'Não foi possível encerrar a viagem.');
    } else if(input.action==='delete') {
      if(typeof input.id!=='string' || input.id.length>100) throw new ApiError(400,'Aparelho inválido.');
      await deleteDevice(db,input.id);
    } else if(input.action==='deleteMany') {
      // Several at once (old test phones). Each is checked like a single delete; the ones on a trip stay.
      const ids=Array.isArray(input.ids)?input.ids.filter((id:unknown)=>typeof id==='string' && id.length<=100):[];
      if(!ids.length || ids.length>200) throw new ApiError(400,'Selecione de 1 a 200 aparelhos.');
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
