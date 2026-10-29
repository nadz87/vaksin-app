import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

// Null until a Supabase project is connected; the app then shows a
// "setup pending" screen instead of crashing.
export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey, { auth: { persistSession: true } }) : null

export function db(): SupabaseClient {
  if (!supabase) throw new Error('Supabase is not configured')
  return supabase
}

// Database function errors are raised as short codes (e.g. 'school_not_found');
// pages translate them with t(`err.${code}`).
export function errorCode(error: unknown): string {
  const message = (error as { message?: string })?.message ?? ''
  const match = message.match(/^[a-z_]+$/)
  return match ? match[0] : 'generic'
}
