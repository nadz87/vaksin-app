import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

export type Role = 'parent' | 'officer' | 'platform_admin'
export type Profile = {
  user_id: string
  role: Role
  full_name: string | null
  phone: string | null
  email: string | null
  address_line1: string | null
  address_line2: string | null
  postcode: string | null
  city: string | null
  state: string | null
}

type Auth = {
  loading: boolean
  session: Session | null
  profile: Profile | null
  /** 'aal2' once an officer/admin has passed 2-step verification. */
  aal: 'aal1' | 'aal2' | null
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<Auth | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [aal, setAal] = useState<Auth['aal']>(null)

  const load = useCallback(async (s: Session | null) => {
    setSession(s)
    if (!supabase || !s) {
      setProfile(null)
      setAal(null)
      setLoading(false)
      return
    }
    const [{ data: p }, { data: level }] = await Promise.all([
      supabase.from('profiles').select('user_id, role, full_name, phone, email, address_line1, address_line2, postcode, city, state').eq('user_id', s.user.id).single(),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    ])
    setProfile((p as Profile) ?? null)
    setAal((level?.currentLevel as Auth['aal']) ?? 'aal1')
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }
    supabase.auth.getSession().then(({ data }) => load(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      // Defer: calling Supabase inside this callback can deadlock the client.
      setTimeout(() => load(s), 0)
    })
    return () => sub.subscription.unsubscribe()
  }, [load])

  const refresh = useCallback(async () => {
    if (!supabase) return
    const { data } = await supabase.auth.getSession()
    await load(data.session)
  }, [load])

  const signOut = useCallback(async () => {
    await supabase?.auth.signOut()
  }, [])

  return (
    <AuthContext.Provider value={{ loading, session, profile, aal, refresh, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): Auth {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}
