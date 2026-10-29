import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { db } from './api'
import { getSession, onChange, signOut as endSession, type StoredSession } from './auth-client'

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
  /** Health officers only, e.g. "Jururawat Kesihatan, KK Presint 9". */
  job_title: string | null
}
export type Session = { user: { id: string; email: string } }

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
  const [stored, setStored] = useState<StoredSession | null>(getSession)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => onChange(setStored), [])

  const userId = stored?.user.id ?? null
  const load = useCallback(async () => {
    if (!userId) {
      setProfile(null)
      setLoading(false)
      return
    }
    const { data } = await db()
      .from('profiles')
      .select('user_id, role, full_name, phone, email, address_line1, address_line2, postcode, city, state, job_title')
      .eq('user_id', userId)
      .maybeSingle()
    setProfile((data as Profile | null) ?? null)
    setLoading(false)
  }, [userId])

  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  const signOut = useCallback(() => endSession(), [])

  // Stable object: pages use the session in effect dependencies.
  const email = stored?.user.email ?? null
  const session = useMemo(() => (userId && email ? { user: { id: userId, email } } : null), [userId, email])
  return (
    <AuthContext.Provider
      value={{
        loading,
        session,
        profile,
        aal: stored?.aal ?? null,
        refresh: load,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): Auth {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}
