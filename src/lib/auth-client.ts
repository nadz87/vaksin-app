// Talks to our own sign-in service (server/auth, behind the gateway at /auth/) and keeps the
// signed-in session in this browser. Tokens live in localStorage, as supabase-js did: the
// site (github.io) and the API (imotion.my) are different sites, so cookies would be blocked.

export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, '') || null

export type Aal = 'aal1' | 'aal2'
export type StoredSession = {
  access_token: string
  refresh_token: string
  /** When the access token expires, in ms since 1970. */
  expires_at: number
  user: { id: string; email: string; role: string }
  aal: Aal
  must_change_password: boolean
}
type TokenReply = Omit<StoredSession, 'expires_at'> & { expires_in: number }

/** Error codes are short strings; pages show them with t(`err.${code}`). */
export type Result<T = true> = { data: T; error: null } | { data: null; error: string }

const KEY = 'vaksin.session'
const listeners = new Set<(session: StoredSession | null) => void>()

function read(): StoredSession | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as StoredSession) : null
  } catch {
    return null
  }
}

let current = read()

function save(session: StoredSession | null) {
  current = session
  try {
    if (session) localStorage.setItem(KEY, JSON.stringify(session))
    else localStorage.removeItem(KEY)
  } catch {
    // Private mode or storage blocked: the session lasts until the page closes.
  }
  listeners.forEach((fn) => fn(session))
}

// Another tab signed in, refreshed or signed out.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return
    current = read()
    listeners.forEach((fn) => fn(current))
  })
}

export function getSession(): StoredSession | null {
  return current
}

export function onChange(fn: (session: StoredSession | null) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function fromReply(reply: TokenReply): StoredSession {
  const { expires_in, ...rest } = reply
  return { ...rest, expires_at: Date.now() + expires_in * 1000 }
}

async function post<T>(path: string, body?: unknown, token?: string | null): Promise<Result<T>> {
  if (!API_URL) return { data: null, error: 'generic' }
  let res: Response
  try {
    res = await fetch(`${API_URL}/auth${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body ?? {}),
    })
  } catch {
    return { data: null, error: 'network' }
  }
  const json = await res.json().catch(() => null)
  if (res.ok) return { data: json as T, error: null }
  // The gateway's flood limit answers with a plain page; the service with {"error": "..."}.
  return { data: null, error: typeof json?.error === 'string' ? json.error : res.status === 429 ? 'rate_limited' : 'generic' }
}

async function signedIn(reply: Result<TokenReply>): Promise<Result> {
  if (reply.error !== null) return reply
  save(fromReply(reply.data))
  return { data: true, error: null }
}

export function startEmail(email: string) {
  return post<{ ok: true }>('/email/start', { email })
}

export async function verifyEmail(email: string, code: string): Promise<Result> {
  return signedIn(await post<TokenReply>('/email/verify', { email, code }))
}

/** Platform admin only: create a health officer account and email them the invitation. */
export async function inviteOfficer(email: string) {
  return post<{ ok: true; already_registered: boolean }>('/invite', { email }, await accessToken())
}

export async function enrollMfa() {
  return post<{ uri: string; secret: string }>('/mfa/enroll', {}, await accessToken())
}

export async function verifyMfa(code: string): Promise<Result> {
  return signedIn(await post<TokenReply>('/mfa/verify', { code }, await accessToken()))
}

export async function signOut(): Promise<void> {
  const token = current?.access_token
  save(null)
  if (token) await post('/logout', {}, token)
}

// ---- Keeping the access token fresh -------------------------------------------------------

let refreshing: Promise<string | null> | null = null

/** A valid access token, refreshed first when it has less than a minute left. */
export async function accessToken(): Promise<string | null> {
  if (!current) return null
  if (current.expires_at - Date.now() > 60_000) return current.access_token
  return refreshNow()
}

/**
 * Swaps the refresh token for new tokens. Only one refresh runs at a time, also across tabs
 * (Web Locks), because each refresh token works once: a second use would end the session.
 */
export function refreshNow(): Promise<string | null> {
  refreshing ??= withLock(doRefresh).finally(() => (refreshing = null))
  return refreshing
}

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  return navigator.locks ? navigator.locks.request('vaksin-refresh', fn) : fn()
}

async function doRefresh(attempt = 0): Promise<string | null> {
  // Another tab may have refreshed while this one waited for the lock.
  const latest = read() ?? current
  if (!latest) return null
  if (latest.expires_at - Date.now() > 60_000) {
    current = latest
    return latest.access_token
  }
  const reply = await post<TokenReply>('/refresh', { refresh_token: latest.refresh_token })
  if (reply.error === null) {
    save(fromReply(reply.data))
    return current!.access_token
  }
  if (reply.error === 'refresh_race' && attempt < 3) {
    // A tab without Web Locks refreshed at the same moment; its new tokens land in storage.
    await new Promise((r) => setTimeout(r, 400))
    return doRefresh(attempt + 1)
  }
  if (['network', 'rate_limited', 'generic', 'server_error'].includes(reply.error)) {
    // Offline or busy: keep the session and try again on the next request.
    return latest.access_token
  }
  save(null) // signed out elsewhere, expired, or disabled
  return null
}
