/** Development proxy. In production the map reads the stream straight from dsb-server
 * (next.config.ts): this path redirects there, or dsb-server intercepts it in the combined
 * Render process. This never reads Supabase per spectator. */
export const dynamic='force-dynamic';
export async function GET(request:Request) {
  const base=process.env.DSB_SERVER_URL ?? (process.env.NODE_ENV==='development'?'http://127.0.0.1:3107':null);
  if(!base)return new Response('Servidor ao vivo não configurado.',{status:503});
  try {
    const upstream=await fetch(new URL('/api/tracker/stream',base),{
      headers:{Cookie:request.headers.get('cookie')??''},cache:'no-store',signal:request.signal,
    });
    return new Response(upstream.body,{status:upstream.status,headers:{'Content-Type':upstream.headers.get('content-type')??'text/plain','Cache-Control':'private, no-store, no-transform','X-Accel-Buffering':'no'}});
  }catch{return new Response('Servidor ao vivo indisponível.',{status:503});}
}
