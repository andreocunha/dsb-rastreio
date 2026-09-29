import { ApiError, database, operator, json, failure } from '@/lib/tracker/server';

export async function GET() {
  try {
    // Organization diagnostics only. Spectators use the shared SSE stream.
    await operator();
    const db=database();
    const {data,error}=await db.from('tracker_latest')
      .select('captured_at,received_at,lat_e7,lon_e7,speed_cm_s,bearing_deg,accuracy_cm,team_id,tracker_devices!inner(enabled),tracker_sessions!inner(ended_at),teams!inner(name,color)')
      .eq('teams.active',true).eq('tracker_devices.enabled',true).is('tracker_sessions.ended_at',null)
      .gte('captured_at',new Date(Date.now()-24*3600000).toISOString()).limit(100);
    if(error) throw new ApiError(503,'Não foi possível atualizar as posições.');
    const boats=(data??[]).map(row=>{
      const team=row.teams as unknown as {name:string;color:string};
      return {id:row.team_id,label:team.name,color:team.color,lat:row.lat_e7/1e7,lon:row.lon_e7/1e7,
        speed:row.speed_cm_s===null ? null : row.speed_cm_s/100*1.943844,heading:row.bearing_deg,
        accuracy:row.accuracy_cm===null ? null : row.accuracy_cm/100,capturedAt:row.captured_at,receivedAt:row.received_at};
    });
    return json({boats,serverTime:new Date().toISOString()});
  } catch(error) { return failure(error); }
}
