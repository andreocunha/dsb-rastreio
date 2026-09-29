// Opt-in: creates isolated fixtures and removes only those exact records in finally.
// Run: TRACKER_RUN_REMOTE_TESTS=yes node --env-file=.env.local tests/tracker.integration.mjs
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {randomUUID,randomBytes} from 'node:crypto';
if(process.env.TRACKER_RUN_REMOTE_TESTS!=='yes') {console.log('Tracker integration: skipped (opt-in).');process.exit(0);}
const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
assert.equal(new URL(url).hostname,'ztzmvdmggxyokfbakajq.supabase.co');
const db=createClient(url,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const device=randomUUID(),team='test-'+randomUUID().replaceAll('-',''),session=randomUUID(),token=randomBytes(32).toString('hex');
const base=process.env.TRACKER_TEST_BASE||'http://localhost:3106';
const t=Date.now();let userId;
async function checked(query){const r=await query;if(r.error)throw Error(r.error.message);return r.data;}
async function mobile(body){const r=await fetch(process.env.TRACKER_ENDPOINT||url+'/functions/v1/tracker',{method:'POST',headers:{'Content-Type':'application/json','x-device-id':device,'x-device-token':token},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};}
try {
 const enrolled=await mobile({action:'enroll'});assert.equal(enrolled.status,201);
 const position={action:'points',sessionId:session,startedAt:t,points:[[randomUUID(),t,10000000,20000000,500,100,180]]};
 assert.equal((await mobile(position)).status,403);
 await checked(db.from('teams').insert({id:team,name:'Tracker integration fixture',initials:'TST',active:false}));
 await checked(db.rpc('tracker_bind_device',{p_code:enrolled.data.code,p_team:team}));
 assert.equal((await mobile(position)).status,200);
 assert.equal((await mobile(position)).status,200);
 assert.equal((await checked(db.from('tracker_points').select('id').eq('device_id',device))).length,1);
 const late={...position,points:[[randomUUID(),t-10000,0,0,null,null,null]]};assert.equal((await mobile(late)).status,200);
 const latest=await checked(db.from('tracker_latest').select('lat_e7').eq('device_id',device).single());assert.equal(latest.lat_e7,10000000);
 const sos={action:'sos',sosId:randomUUID(),sessionId:session,startedAt:t,triggeredAt:t,latE7:10000000,lonE7:20000000};
 assert.equal((await mobile(sos)).status,201);assert.equal((await mobile(sos)).status,200);
 const second={...sos,sosId:randomUUID(),triggeredAt:t+1};assert.equal((await mobile(second)).status,201);
 assert.equal((await checked(db.from('tracker_sos').select('id').eq('device_id',device))).length,2);
 await checked(db.from('tracker_sos').update({status:'resolved',resolved_at:new Date().toISOString()}).eq('id',sos.sosId));
 assert.equal((await mobile(sos)).data.status,'resolved');
 assert.equal((await mobile({action:'status',sessionId:session,sosId:sos.sosId})).data.openSosStatus,'resolved');
 // The server under test must run with this ADMIN_PASSWORD.
 const password=process.env.ADMIN_PASSWORD;assert.ok(password,'Set ADMIN_PASSWORD for the integration test');
 const login=value=>fetch(base+'/api/admin/session',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({password:value})});
 assert.equal((await login(password+'x')).status,401,'Wrong password must not enter');
 const response=await login(password);assert.equal(response.status,200);
 const cookie=response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
 assert.equal((await fetch(base+'/api/admin/tracker')).status,401);
 const overview=await fetch(base+'/api/admin/tracker',{headers:{Cookie:cookie}});assert.equal(overview.status,200);
 assert.ok((await overview.json()).devices.some(d=>d.id===device));
 assert.equal((await fetch(base+'/api/admin/tracker',{method:'POST',headers:{Cookie:cookie,Origin:'https://untrusted.example','Content-Type':'application/json'},body:JSON.stringify({action:'disable',id:device})})).status,403);
 const live=await fetch(base+'/api/tracker/live',{headers:{Cookie:cookie}});assert.equal(live.status,200);assert.ok(!(await live.json()).boats.some(b=>b.id===team),'Inactive fixture boat must stay off map');
 // Exercise the real HTTP event stream against the persisted latest position.
 if(process.env.TRACKER_ENDPOINT) {
   await checked(db.from('teams').update({active:true}).eq('id',team));
   const controller=new AbortController();
   const stream=await fetch(new URL('/api/tracker/stream',process.env.TRACKER_ENDPOINT),{signal:controller.signal});
   assert.equal(stream.status,200);assert.match(stream.headers.get('content-type'),/text\/event-stream/);
   const reader=stream.body.getReader();let buffered='';
   const timeout=setTimeout(()=>controller.abort(),15000);
   async function until(predicate){while(true){const {value,done}=await reader.read();if(done)throw Error('SSE closed');buffered+=new TextDecoder().decode(value);const frames=buffered.split('\n\n');buffered=frames.pop();for(const frame of frames){const line=frame.split('\n').find(l=>l.startsWith('data: '));if(line&&predicate(JSON.parse(line.slice(6))))return;}}}
   try {
     await until(d=>d.b?.some(b=>b[0]===team)||d.p?.some(b=>b[0]===team));
     const updated={...position,points:[[randomUUID(),t+2000,10000001,20000001,500,100,180]]};assert.equal((await mobile(updated)).status,200);
     await until(d=>d.p?.some(b=>b[0]===team&&b[1]===10000001));
     await checked(db.from('teams').update({active:false}).eq('id',team));
     await until(d=>d.r?.includes(team));
   }finally{clearTimeout(timeout);controller.abort();await reader.cancel().catch(()=>{});}
 }
 const ack=await fetch(base+'/api/admin/tracker',{method:'POST',headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json'},body:JSON.stringify({action:'sos',id:second.sosId,status:'acknowledged'})});assert.equal(ack.status,200);
 assert.equal((await mobile({action:'status',sessionId:session,sosId:second.sosId})).data.openSosStatus,'acknowledged');
 assert.equal((await mobile({action:'end',sessionId:session,startedAt:t,endedAt:Date.now()})).status,200);
 await checked(db.from('tracker_devices').update({enabled:false}).eq('id',device));assert.equal((await mobile(position)).status,403);
 console.log('PASS: device authorization, idempotent points, latest position, repeated SOS, resolved retry, admin role, CSRF, live privacy, support acknowledgment, end and revocation.');
} finally {
 for(const table of ['tracker_latest','tracker_points','tracker_sos','tracker_sessions']) await checked(db.from(table).delete().eq('device_id',device));
 await checked(db.from('tracker_devices').delete().eq('id',device));
 await checked(db.from('teams').delete().eq('id',team));
 if(userId){await checked(db.from('tracker_operators').delete().eq('user_id',userId));const result=await db.auth.admin.deleteUser(userId);if(result.error)throw result.error;}
 console.log('Temporary fixtures removed.');
}
