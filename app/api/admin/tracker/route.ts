import { ApiError, database, operator, sameOrigin, body, json, failure } from '@/lib/tracker/server';

export async function GET() {
  try {
    await operator(); const db=database();
    const [teams,devices,alerts]=await Promise.all([
      db.from('teams').select('*').eq('active',true).order('name'),
      db.from('tracker_devices').select('id,display_code,team_id,enabled,created_at,last_seen_at').order('created_at',{ascending:false}).limit(500),
      db.from('tracker_sos').select('id,team_id,status,triggered_at,received_at,lat_e7,lon_e7').neq('status','resolved').order('received_at',{ascending:false}).limit(100),
    ]);
    if(teams.error || devices.error || alerts.error) throw new ApiError(503,'Não foi possível carregar a organização.');
    return json({teams:teams.data,devices:devices.data,alerts:alerts.data});
  } catch(error) { return failure(error); }
}
export async function POST(request:Request) {
  try {
    sameOrigin(request); await operator(); const input=await body(request); const db=database();
    if(input.action==='bind') {
      const code=String(input.code??'').replace(/\s/g,'').toUpperCase(); const teamId=String(input.teamId??'');
      if(!/^[A-F0-9]{10}$/.test(code) || !teamId || teamId.length>100) throw new ApiError(400,'Confira o código de 10 caracteres e o barco.');
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
    } else if(input.action==='createBoat') {
      const name=String(input.name??'').trim(); const initials=String(input.initials??'').trim().toUpperCase();
      if(name.length<2 || name.length>60 || !/^[A-Z0-9À-Ÿ]{1,3}$/.test(initials)) throw new ApiError(400,'Informe nome e sigla de até 3 caracteres.');
      const id=`trk-${crypto.randomUUID().replaceAll('-','')}`;
      const result=await db.from('teams').insert({id,name,initials,color:'blue',university:''});
      if(result.error) throw new ApiError(400,'Não foi possível cadastrar o barco.');
    } else if(input.action==='style') {
      // Map appearance only: colour, hull form and outboard count.
      const teamId=String(input.teamId??''),color=String(input.color??''),hull=String(input.hull??''),motors=Number(input.motors);
      if(!teamId || teamId.length>100 || !['green','gold','blue','orange','purple','cyan'].includes(color) || !['cat','mono'].includes(hull) || ![1,2,3].includes(motors)) throw new ApiError(400,'Aparência inválida.');
      const result=await db.from('teams').update({color,boat_hull:hull,boat_motors:motors}).eq('id',teamId).select('id').single();
      if(result.error) throw new ApiError(result.error.code==='42703'||result.error.code==='PGRST204'?503:400,result.error.code==='42703'||result.error.code==='PGRST204'?'Aplique a migração de aparência dos barcos no banco.':'Não foi possível salvar a aparência.');
    } else if(input.action==='sos') {
      if(!['acknowledged','resolved'].includes(input.status) || typeof input.id!=='string') throw new ApiError(400,'Estado de SOS inválido.');
      const patch=input.status==='acknowledged' ? {status:input.status,acknowledged_at:new Date().toISOString()} : {status:input.status,resolved_at:new Date().toISOString()};
      const result=await db.from('tracker_sos').update(patch).eq('id',input.id).neq('status','resolved').select('id').single();
      if(result.error) throw new ApiError(409,'Este chamado já foi atualizado. Recarregue.');
    } else throw new ApiError(400,'Ação inválida.');
    return json({ok:true});
  } catch(error) { return failure(error); }
}
