'use client';
/**
 * The organizer's session on the client. Opened directly, the site also has a cookie; inside the DSB
 * app's iframe browsers don't send that cookie, so every admin request carries the session as a
 * Bearer header instead (kept for this tab only).
 */
const KEY = 'dsb:admin', HINT = 'dsb:admin-hint';
let memory: string | null = null;

export function adminToken() {
  if (memory) return memory;
  try { memory = sessionStorage.getItem(KEY); } catch { /* storage blocked: memory only */ }
  return memory;
}
function remember(token: string | null) {
  memory = token;
  try { if (token) sessionStorage.setItem(KEY, token); else sessionStorage.removeItem(KEY); } catch { /* storage blocked */ }
}

/** fetch() for /api/admin/*: adds the session and turns errors into exceptions with the server's message. */
export async function adminFetch<T = Record<string, unknown>>(url: string, init: RequestInit & {json?: unknown} = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = adminToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let body = init.body;
  if (init.json !== undefined) { headers.set('Content-Type', 'application/json'); body = JSON.stringify(init.json); }
  const response = await fetch(url, {...init, body, headers, cache: 'no-store'});
  const result = await response.json().catch(() => ({}));
  if (response.status === 401 && token) remember(null);
  if (!response.ok) throw Object.assign(Error(result.error || 'Não foi possível concluir. Tente novamente.'), {status: response.status});
  return result as T;
}

/** Remembers that an organizer signed in on this browser (the session cookie itself is not readable here). */
function hint(on: boolean) {
  try { if (on) localStorage.setItem(HINT, '1'); else localStorage.removeItem(HINT); } catch { /* storage blocked */ }
}
/** Worth asking the server? Spectators never signed in here, and each question is a function call on the host. */
export function mayHaveAdminSession() {
  if (adminToken()) return true;
  try { return localStorage.getItem(HINT) === '1'; } catch { return false; }
}

/** Is there a valid organizer session (cookie or this tab's token)? */
export async function hasAdminSession() {
  let admin: boolean;
  try { admin = (await adminFetch<{admin: boolean}>('/api/admin/session?probe=1')).admin === true; } catch { return false; }
  hint(admin);
  return admin;
}

async function startSession(input: {password: string} | {accessToken: string}) {
  const result = await adminFetch<{token: string}>('/api/admin/session', {method: 'POST', json: input});
  remember(result.token); hint(true);
}
export const loginWithPassword = (password: string) => startSession({password});

/** Inside the DSB app: are we in an iframe whose parent can hand over the signed-in account? */
export const insideApp = () => { try { return window.self !== window.top; } catch { return true; } };

/**
 * Asks the DSB app (the parent window) for the signed-in user's access token and exchanges it for
 * an organizer session. The app only answers for accounts in its admin list; the server checks
 * the token with Supabase and the same list again.
 */
export function loginWithApp(timeout = 8000) {
  return new Promise<void>((resolve, reject) => {
    const done = (error?: Error) => { clearTimeout(timer); removeEventListener('message', listen); if (error) reject(error); else resolve(); };
    const listen = (event: MessageEvent) => {
      if (event.source !== window.parent || event.data?.type !== 'dsb-tracker:token') return;
      if (typeof event.data.token !== 'string') return done(Error(event.data.error || 'Entre no app com a conta da organização.'));
      startSession({accessToken: event.data.token}).then(() => done(), error => done(error as Error));
    };
    const timer = setTimeout(() => done(Error('O app não respondeu. Atualize o app e tente de novo.')), timeout);
    addEventListener('message', listen);
    window.parent.postMessage({type: 'dsb-tracker:token?'}, '*');
  });
}

export async function logout() {
  try { await adminFetch('/api/admin/session', {method: 'DELETE'}); } catch { /* the session is dropped here anyway */ }
  remember(null); hint(false);
}
