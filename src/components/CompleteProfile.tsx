import { useState, type FormEvent, type ReactNode } from 'react'
import { db } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useI18n } from '../lib/i18n'
import { normalizeMyPhone } from '../lib/phone'
import { Centered, ErrorText } from './Layout'

/**
 * The "sign up" part of sign-up: a parent who has no name or phone yet sees
 * this once, before anything else. Officers fill in theirs after 2-step (StaffGate).
 */
export function RequireParentProfile({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const missing = profile?.role === 'parent' && (!profile.full_name || !profile.phone)
  return missing ? <CompleteProfile /> : <>{children}</>
}

/**
 * Parents: name and phone (both required). Officers (`officer`): name and job title /
 * clinic required, phone optional; the platform admin sees this on the admin page.
 */
export function CompleteProfile({ officer = false }: { officer?: boolean }) {
  const { t } = useI18n()
  const { profile, refresh } = useAuth()
  const [fullName, setFullName] = useState(profile?.full_name ?? '')
  const [jobTitle, setJobTitle] = useState(profile?.job_title ?? '')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const normalized = phone.trim() ? normalizeMyPhone(phone) : null
    if (phone.trim() && !normalized) return setError('invalid_phone')
    if (!officer && !normalized) return setError('invalid_phone')
    setBusy(true)
    setError(null)
    const changes: Record<string, string | null> = { full_name: fullName.trim(), phone: normalized }
    if (officer) changes.job_title = jobTitle.trim()
    const { error } = await db().from('profiles').update(changes).eq('user_id', profile!.user_id)
    setBusy(false)
    if (error) return setError('generic')
    await refresh()
  }

  const ready = fullName.trim().length >= 2 && (officer ? jobTitle.trim().length >= 2 : phone.trim().length > 0)

  return (
    <Centered>
      <form onSubmit={submit} className="space-y-4">
        <h2 className="text-xl font-bold">{t(officer ? 'profile.officerTitle' : 'profile.title')}</h2>
        <p className="text-sm text-muted">{t(officer ? 'profile.officerBody' : 'profile.body')}</p>
        <label className="block">
          <span className="label">{t('profile.fullName')}</span>
          <input
            className="field"
            autoComplete="name"
            required
            minLength={2}
            maxLength={120}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </label>
        {officer && (
          <label className="block">
            <span className="label">{t('profile.jobTitle')}</span>
            <input
              className="field"
              autoComplete="organization-title"
              placeholder={t('profile.jobTitleHint')}
              required
              minLength={2}
              maxLength={120}
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
            />
          </label>
        )}
        <label className="block">
          <span className="label">{t(officer ? 'profile.phoneOptional' : 'profile.phone')}</span>
          <input
            className="field"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder={t('profile.phoneHint')}
            required={!officer}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </label>
        <ErrorText code={error} />
        <button className="btn-primary" disabled={busy || !ready}>
          {t('profile.save')}
        </button>
      </form>
    </Centered>
  )
}
