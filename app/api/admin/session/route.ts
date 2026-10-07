import { sameOrigin, body, json, failure, operator, checkPassword, checkAccessToken, startSession, endSession } from '@/lib/tracker/server';

export async function GET(request:Request) {
  // ?probe=1 lets the public map ask quietly (200) whether to show organizer tools.
  if(new URL(request.url).searchParams.get('probe')==='1'){try{await operator();return json({admin:true});}catch{return json({admin:false});}}
  try { await operator(); return json({ok:true}); } catch(error) { return failure(error); }
}
export async function POST(request:Request) {
  try {
    sameOrigin(request); const input=await body(request);
    // Inside the DSB app: the user's own account. Opened directly: the organization password.
    if(input.accessToken!==undefined) await checkAccessToken(input.accessToken); else checkPassword(input.password);
    return json({ok:true,token:await startSession()});
  }
  catch(error) { return failure(error); }
}
export async function DELETE(request:Request) {
  try { sameOrigin(request); await endSession(); return json({ok:true}); } catch(error) { return failure(error); }
}
