import { useState, type FormEvent } from 'react'
import { startEmail, verifyEmail } from '../lib/auth-client'
import { useI18n } from '../lib/i18n'
import { ErrorText } from './Layout'

/**
 * Sign-in and sign-up in one: email, then a 6-digit code. A new parent email
 * gets an account automatically; name and phone are asked next (CompleteProfile).
 * `staff`: the officer and admin pages (accounts come from an invitation).
 */
export function EmailSignIn({ onSignedIn, staff = false }: { onSignedIn?: () => void; staff?: boolean }) {
  const { t } = useI18n()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await startEmail(email.trim())
    setBusy(false)
    if (error) setError(error)
    else setSent(true)
  }

  async function verify(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await verifyEmail(email.trim(), code.trim())
    setBusy(false)
    if (error) setError(error === 'otp_invalid' ? 'otp' : error)
    else onSignedIn?.()
  }

  if (!sent) {
    return (
      <form onSubmit={send} className="space-y-4">
        <h2 className="text-xl font-bold">{t(staff ? 'officer.title' : 'signin.title')}</h2>
        <p className="text-sm text-muted">{t(staff ? 'officer.codeHint' : 'signin.newHint')}</p>
        <label className="block">
          <span className="label">{t('signin.email')}</span>
          <input
            className="field"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <ErrorText code={error} />
        <button className="btn-primary" disabled={busy || !email.includes('@')}>
          {t('signin.send')}
        </button>
      </form>
    )
  }

  return (
    <form onSubmit={verify} className="space-y-4">
      <h2 className="text-xl font-bold">{t(staff ? 'officer.title' : 'signin.title')}</h2>
      <p className="text-sm text-muted">
        {t('signin.sent')} <strong className="text-ink">{email}</strong>
      </p>
      <label className="block">
        <span className="label">{t('signin.code')}</span>
        <input
          className="field text-center text-2xl tracking-[0.4em]"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          required
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        />
      </label>
      <ErrorText code={error} />
      <button className="btn-primary" disabled={busy || code.length !== 6}>
        {t('signin.verify')}
      </button>
      <button type="button" className="w-full text-sm text-muted" onClick={() => setSent(false)}>
        {t('signin.change')}
      </button>
    </form>
  )
}
