import 'server-only';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
export function database() {
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret=process.env.SUPABASE_SECRET_KEY;
  if(!url || !secret) throw new ApiError(503,'Servidor ainda não configurado.');
  return createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
}
const SESSION_COOKIE='dsb_admin',SESSION_SECONDS=12*3600;
const digest=(value:string)=>createHash('sha256').update(value).digest();
function adminPassword() {
  const password=process.env.ADMIN_PASSWORD;
  if(!password || password.length<8) throw new ApiError(503,'Defina ADMIN_PASSWORD (8+ caracteres) no .env.');
  return password;
}
// Sessions are signed with the password itself: changing it logs everyone out.
const sign=(expires:number)=>createHmac('sha256',process.env.ADMIN_SESSION_SECRET || adminPassword()).update(`dsb-admin:${expires}`).digest('base64url');
const attempts:number[]=[];
export function checkPassword(candidate:unknown) {
  const now=Date.now();
  while(attempts.length && now-attempts[0]>60000) attempts.shift();
  // A small global budget: brute force stays impractical on the single instance.
  if(attempts.length>=10) throw new ApiError(429,'Muitas tentativas. Aguarde um minuto.');
  attempts.push(now);
  if(typeof candidate!=='string' || candidate.length>512) throw new ApiError(400,'Informe a senha.');
  if(!timingSafeEqual(digest(candidate),digest(adminPassword()))) throw new ApiError(401,'Senha incorreta.');
}
export async function startSession() {
  const expires=Math.floor(Date.now()/1000)+SESSION_SECONDS;
  (await cookies()).set(SESSION_COOKIE,`${expires}.${sign(expires)}`,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:SESSION_SECONDS});
}
export async function endSession() { (await cookies()).delete(SESSION_COOKIE); }
export async function operator() {
  const value=(await cookies()).get(SESSION_COOKIE)?.value ?? '';
  const [raw,signature='']=value.split('.');const expires=Number(raw);
  if(!value || !Number.isInteger(expires)) throw new ApiError(401,'Entre para continuar.');
  const expected=sign(expires);
  if(signature.length!==expected.length || !timingSafeEqual(Buffer.from(signature),Buffer.from(expected)) || expires*1000<Date.now())
    throw new ApiError(401,'Sua sessão expirou. Entre novamente.');
  return {expires};
}
export function sameOrigin(request:Request) {
  // Custom servers/proxies may expose an internal URL to Next. Pin browser writes
  // to the deployment's public origin; never trust arbitrary forwarded headers.
  const configured=process.env.PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL;
  const expected=new URL(configured || request.url).origin;
  if(request.headers.get('origin')!==expected) throw new ApiError(403,'Origem inválida.');
}
export async function body(request:Request,maxLength=8192) {
  if(!request.headers.get('content-type')?.startsWith('application/json')) throw new ApiError(415,'Use JSON.');
  const text=await request.text();
  if(text.length>maxLength) throw new ApiError(413,'Pedido muito grande.');
  try { const value=JSON.parse(text); if(!value || typeof value!=='object' || Array.isArray(value)) throw Error(); return value; }
  catch { throw new ApiError(400,'Pedido inválido.'); }
}
export function json(value:unknown,status=200) { return Response.json(value,{status,headers:{'Cache-Control':'private, no-store'}}); }
export function failure(error:unknown) {
  return json({error:error instanceof ApiError ? error.message : 'Não foi possível concluir. Tente novamente.'},error instanceof ApiError ? error.status : 500);
}
