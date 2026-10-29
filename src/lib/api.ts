// The database API (PostgREST on our own server, behind the gateway at /rest/). Same
// `.from()` / `.rpc()` calls as before; the signed-in user's token is added to each request.
import { PostgrestClient } from '@supabase/postgrest-js'
import { API_URL, accessToken, refreshNow } from './auth-client'

/** False until the website is built with VITE_API_URL; the app then shows "being set up". */
export const apiReady = Boolean(API_URL)

async function authedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const send = (token: string | null) => {
    const headers = new Headers(init?.headers)
    if (token) headers.set('Authorization', `Bearer ${token}`)
    return fetch(input, { ...init, headers })
  }
  const token = await accessToken()
  const res = await send(token)
  // The token ran out between the check and the request (or this device's clock is off).
  if (res.status === 401 && token) {
    const fresh = await refreshNow()
    if (fresh && fresh !== token) return send(fresh)
  }
  return res
}

const client = API_URL ? new PostgrestClient(`${API_URL}/rest`, { fetch: authedFetch }) : null

export function db(): PostgrestClient {
  if (!client) throw new Error('VITE_API_URL is not configured')
  return client
}

// Database function errors are raised as short codes (e.g. 'school_not_found');
// pages translate them with t(`err.${code}`).
export function errorCode(error: unknown): string {
  const message = (error as { message?: string })?.message ?? ''
  const match = message.match(/^[a-z_]+$/)
  return match ? match[0] : 'generic'
}
