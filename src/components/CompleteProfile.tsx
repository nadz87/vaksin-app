import { useState, type FormEvent, type ReactNode } from 'react'
import { db } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useI18n } from '../lib/i18n'
import { normalizeMyPhone } from '../lib/phone'
import { Centered, ErrorText } from './Layout'

/**
 * The "sign up" part of sign-up: a parent who has no name or phone yet sees
 * this once, before anything else. Staff accounts are created by the admin.
 */
export function RequireParentProfile({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const missing = profile?.role === 'parent' && (!profile.full_name || !profile.phone)
  return missing ? <CompleteProfile /> : <>{children}</>
}

function CompleteProfile() {
  const { t } = useI18n()
  const { profile, refresh } = useAuth()
  const [fullName, setFullName] = useState(profile?.full_name ?? '')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const normalized = normalizeMyPhone(phone)
    if (!normalized) return setError('invalid_phone')
    setBusy(true)
    setError(null)
    const { error } = await db()
      .from('profiles')
      .update({ full_name: fullName.trim(), phone: normalized })
      .eq('user_id', profile!.user_id)
    setBusy(false)
    if (error) return setError('generic')
    await refresh()
  }

  return (
    <Centered>
      <form onSubmit={submit} className="space-y-4">
        <h2 className="text-xl font-bold">{t('profile.title')}</h2>
        <p className="text-sm text-muted">{t('profile.body')}</p>
        <label className="block">
          <span className="label">{t('profile.fullName')}</span>
          <input
            className="field"
            autoComplete="name"
            required
            minLength={2}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="label">{t('profile.phone')}</span>
          <input
            className="field"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder={t('profile.phoneHint')}
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </label>
        <ErrorText code={error} />
        <button className="btn-primary" disabled={busy || fullName.trim().length < 2 || !phone.trim()}>
          {t('profile.save')}
        </button>
      </form>
    </Centered>
  )
}
