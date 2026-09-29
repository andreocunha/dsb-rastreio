import { sameOrigin, body, json, failure, operator, checkPassword, startSession, endSession } from '@/lib/tracker/server';

export async function GET(request:Request) {
  // ?probe=1 lets the public map ask quietly (200) whether to show organizer tools.
  if(new URL(request.url).searchParams.get('probe')==='1'){try{await operator();return json({admin:true});}catch{return json({admin:false});}}
  try { await operator(); return json({ok:true}); } catch(error) { return failure(error); }
}
export async function POST(request:Request) {
  try { sameOrigin(request); const input=await body(request); checkPassword(input.password); await startSession(); return json({ok:true}); }
  catch(error) { return failure(error); }
}
export async function DELETE(request:Request) {
  try { sameOrigin(request); await endSession(); return json({ok:true}); } catch(error) { return failure(error); }
}
