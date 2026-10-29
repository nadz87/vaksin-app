import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { db, errorCode } from '../lib/api'
import { enrollMfa, inviteOfficer, verifyMfa } from '../lib/auth-client'
import { useAuth } from '../lib/auth'
import { useI18n } from '../lib/i18n'
import { Centered, ErrorText, Loading } from '../components/Layout'
import { CompleteProfile } from '../components/CompleteProfile'
import { EmailSignIn } from '../components/EmailSignIn'
import type { CalSchool } from './officer-calendar'
import { StudentsTab } from './officer-students'
import { CalendarScreen, HomeScreen } from './officer-dashboard'
import { MySchools, SETTINGS_VIEWS, SettingsScreen } from './officer-settings'
import { Icon, type IconName } from '../components/icons'


/**
 * Officer and platform-admin pages sit behind this gate: an emailed code (no passwords),
 * then 2-step verification (database rules require aal2), then, for officers, their
 * profile once.
 */
export function StaffGate({ allow, children }: { allow: Array<'officer' | 'platform_admin'>; children: ReactNode }) {
  const { t } = useI18n()
  const { loading, session, profile, aal } = useAuth()

  if (loading) return <Loading />
  if (!session) {
    return (
      <Centered>
        <EmailSignIn staff />
      </Centered>
    )
  }
  if (!profile || !allow.includes(profile.role as 'officer' | 'platform_admin')) {
    return (
      <Centered>
        <p>{t('officer.notOfficer')}</p>
      </Centered>
    )
  }
  if (aal !== 'aal2') return <TwoStep />
  if (profile.role === 'officer' && (!profile.full_name || !profile.job_title)) return <CompleteProfile officer />
  return <>{children}</>
}

/** Set up an authenticator app the first time, verify a code every time after. */
function TwoStep() {
  const { t } = useI18n()
  const [mode, setMode] = useState<'loading' | 'enrol' | 'verify'>('loading')
  const [qr, setQr] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // React dev mode runs effects twice; a second set-up would replace the first secret,
  // leaving the QR code on screen out of date.
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    ;(async () => {
      const { data, error } = await enrollMfa()
      if (error === 'mfa_already_enrolled') return setMode('verify')
      if (error || !data) return setError(error ?? 'generic')
      const QRCode = await import('qrcode')
      setQr(await QRCode.toDataURL(data.uri, { margin: 1, width: 384 }))
      setSecret(data.secret)
      setMode('enrol')
    })()
  }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    // On success the stored session becomes aal2 and the gate opens by itself.
    const { error } = await verifyMfa(code)
    setBusy(false)
    if (error) setError(error === 'mfa_invalid' ? 'otp' : error)
  }

  if (mode === 'loading') return error ? <Centered><ErrorText code={error} /></Centered> : <Loading />

  return (
    <Centered>
      <form onSubmit={submit} className="space-y-4">
        <h2 className="text-xl font-bold">{qr ? t('mfa.enrollTitle') : t('mfa.verifyTitle')}</h2>
        <p className="text-sm text-muted">{qr ? t('mfa.enrollBody') : t('mfa.verifyBody')}</p>
        {qr && <img src={qr} alt="QR" className="mx-auto h-48 w-48 rounded-xl bg-white p-2" />}
        {secret && (
          <p className="text-center text-xs text-muted">
            {t('mfa.manual')} <code className="break-all font-mono text-ink">{secret.replace(/(.{4})/g, '$1 ').trim()}</code>
          </p>
        )}
        <input
          className="field text-center text-2xl tracking-[0.4em]"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          required
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        />
        <ErrorText code={error} />
        <button className="btn-primary" disabled={busy || code.length !== 6}>
          {t('mfa.verify')}
        </button>
      </form>
    </Centered>
  )
}

/** Officer home: greeting, a top menu (Utama, Kalendar, Murid, Tetapan) and the chosen screen. */
export function OfficerHome() {
  const { t } = useI18n()
  const { profile, session } = useAuth()
  const [schools, setSchools] = useState<CalSchool[] | null>(null)
  // Section, view, school and day live in the address, so Back from a student profile lands in the same place.
  const [params, setParams] = useSearchParams()
  const sections = ['home', 'calendar', 'students', 'settings'] as const
  const section = sections.find((x) => x === params.get('s')) ?? 'home'
  const schoolId = params.get('school')
  const day = params.get('day') ?? undefined
  const view = params.get('v')

  // Changing section clears the sub-view; an empty value removes a parameter.
  function go(next: Record<string, string>) {
    const p = new URLSearchParams(params)
    if ('s' in next) p.delete('v')
    for (const [k, v] of Object.entries(next)) {
      if (v === '') p.delete(k)
      else p.set(k, v)
    }
    setParams(p, { replace: true })
  }

  // Officers only see the schools they chose; this reloads after they add or leave one.
  const [reloads, setReloads] = useState(0)
  useEffect(() => {
    db()
      .from('schools')
      .select('id, name, weekend_days')
      .order('name')
      .then(({ data }) => setSchools((data as CalSchool[]) ?? []))
  }, [reloads])
  const schoolsChanged = () => setReloads((n) => n + 1)

  if (!schools) return <Loading />

  const school = schools.find((s) => s.id === schoolId) ?? schools[0] ?? null
  const name = profile?.full_name ?? session?.user.email ?? ''

  const menu: Array<{ key: (typeof sections)[number]; icon: IconName }> = [
    { key: 'home', icon: 'home' },
    { key: 'calendar', icon: 'calendar' },
    { key: 'students', icon: 'users' },
    { key: 'settings', icon: 'settings' },
  ]

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-10">
      <div className="flex items-center gap-3">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-primary-soft text-lg font-bold text-primary">
          {name.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold">
            {t('oh.hello')} {name}
          </p>
          {school && (
            <p className="truncate text-sm text-muted">
              {school.name} ·{' '}
              <button className="font-medium text-primary" onClick={() => go({ s: 'settings' })}>
                {t('oh.change')}
              </button>
            </p>
          )}
        </div>
      </div>

      <nav aria-label="Menu" className="grid grid-cols-4 gap-1.5 rounded-2xl bg-surface p-1.5 shadow-[0_4px_14px_rgba(31,52,110,0.06)]">
        {menu.map((m) => {
          const active = section === m.key
          return (
            <button
              key={m.key}
              aria-current={active ? 'page' : undefined}
              onClick={() => go({ s: m.key })}
              className={`flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-2.5 text-sm font-semibold transition sm:flex-row sm:gap-2 ${
                active ? 'bg-primary text-white' : 'text-ink hover:bg-page'
              }`}
            >
              <Icon name={m.icon} className="h-5 w-5" />
              <span className="text-xs sm:text-sm">{t(`nav.${m.key}`)}</span>
            </button>
          )
        })}
      </nav>

      {schools.length === 0 && <MySchools first mine={[]} onChange={schoolsChanged} />}

      {school && section === 'home' && <HomeScreen key={school.id} school={school} go={(s, v) => go({ s, ...(v ? { v } : {}) })} />}
      {school && section === 'calendar' && (
        <CalendarScreen
          key={school.id}
          school={school}
          schools={schools}
          initialDay={day}
          view={view === 'slots' ? 'slots' : 'list'}
          onView={(v) => go({ v: v === 'slots' ? 'slots' : '' })}
          onSwitchSchool={(id, d) => go({ school: id, day: d })}
        />
      )}
      {school && section === 'students' && <StudentsTab key={school.id} school={school} />}
      {school && section === 'settings' && (
        <SettingsScreen
          schools={schools}
          school={school}
          view={SETTINGS_VIEWS.find((x) => x === view) ?? 'school'}
          onView={(v) => go({ v })}
          onPickSchool={(id) => go({ school: id })}
          onSchoolsChanged={schoolsChanged}
        />
      )}
    </div>
  )
}

type Officer = {
  user_id: string
  email: string
  full_name: string | null
  phone: string | null
  job_title: string | null
  active: boolean
  registered: boolean
  two_step: boolean
  invited_at: string
  last_sign_in_at: string | null
  schools: Array<{ id: string; name: string }>
}

/**
 * iMotion platform admin: invite health officers by email and see their profiles.
 * Officers complete their own profile and choose their schools.
 */
export function AdminOfficers() {
  const { t } = useI18n()
  const [officers, setOfficers] = useState<Officer[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const { data, error } = await db().rpc('admin_officers')
    if (error) return setError(errorCode(error))
    setOfficers((data as Officer[]) ?? [])
  }
  useEffect(() => {
    load()
  }, [])

  const registered = (officers ?? []).filter((o) => o.registered)
  const waiting = (officers ?? []).filter((o) => !o.registered)

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-10">
      <h1 className="text-2xl font-bold">{t('admin.title')}</h1>
      <InviteOfficer onInvited={load} />

      <section className="space-y-3">
        <h2 className="text-lg font-bold">
          {t('admin.officers')} {officers && <span className="font-normal text-muted">({registered.length})</span>}
        </h2>
        <ErrorText code={error} />
        {!officers && !error && <Loading />}
        {officers && registered.length === 0 && <p className="card text-muted">{t('admin.noOfficers')}</p>}
        {registered.map((o) => (
          <OfficerCard key={o.user_id} officer={o} onChange={load} />
        ))}
      </section>

      {waiting.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-bold">
            {t('admin.waiting')} <span className="font-normal text-muted">({waiting.length})</span>
          </h2>
          <p className="text-sm text-muted">{t('admin.waitingBody')}</p>
          {waiting.map((o) => (
            <WaitingCard key={o.user_id} officer={o} />
          ))}
        </section>
      )}
    </div>
  )
}

function InviteOfficer({ onInvited }: { onInvited: () => void }) {
  const { t } = useI18n()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setSent(null)
    const { error } = await inviteOfficer(email.trim())
    setBusy(false)
    if (error) return setError(error)
    setSent(email.trim().toLowerCase())
    setEmail('')
    onInvited()
  }

  return (
    <form onSubmit={submit} className="card space-y-3">
      <h2 className="text-lg font-bold">{t('admin.inviteTitle')}</h2>
      <p className="text-sm text-muted">{t('admin.inviteBody')}</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          className="field"
          type="email"
          inputMode="email"
          autoComplete="off"
          aria-label={t('admin.inviteEmail')}
          placeholder={t('admin.inviteEmail')}
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button className="btn-primary sm:w-auto" disabled={busy || !email.includes('@')}>
          {t('admin.inviteSend')}
        </button>
      </div>
      {sent && <p className="text-sm text-success">{t('admin.inviteSent').replace('{e}', sent)}</p>}
      <ErrorText code={error} />
    </form>
  )
}

function dateText(iso: string, lang: string) {
  return new Date(iso).toLocaleDateString(lang === 'ms' ? 'ms-MY' : 'en-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function OfficerCard({ officer: o, onChange }: { officer: Officer; onChange: () => void }) {
  const { t, lang } = useI18n()
  const [error, setError] = useState<string | null>(null)
  const name = o.full_name ?? o.email

  async function run(fn: string, args: Record<string, unknown>, confirmKey: string) {
    if (!window.confirm(t(confirmKey).replace('{n}', name))) return
    setError(null)
    const { error } = await db().rpc(fn, args)
    if (error) return setError(errorCode(error))
    onChange()
  }

  return (
    <article className={`card space-y-3 ${o.active ? '' : 'opacity-70'}`}>
      <div className="flex items-start gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary-soft font-bold text-primary">
          {name.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{name}</p>
          <p className="text-sm text-muted">{o.job_title ?? t('admin.noTitle')}</p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
            !o.active ? 'bg-page text-muted' : o.two_step ? 'bg-success/15 text-success' : 'bg-page text-muted'
          }`}
        >
          {!o.active ? t('admin.disabled') : o.two_step ? t('admin.twoStepOn') : t('admin.twoStepOff')}
        </span>
      </div>

      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-muted">{t('signin.email')}</dt>
        <dd className="break-all">{o.email}</dd>
        <dt className="text-muted">{t('profile.phone')}</dt>
        <dd>{o.phone ?? '—'}</dd>
        <dt className="text-muted">{t('admin.schoolsServed')}</dt>
        <dd>{o.schools.length ? o.schools.map((s) => s.name).join(', ') : t('admin.noSchools')}</dd>
        <dt className="text-muted">{t('admin.lastSignIn')}</dt>
        <dd>{o.last_sign_in_at ? dateText(o.last_sign_in_at, lang) : '—'}</dd>
      </dl>

      <div className="flex flex-wrap gap-x-4 gap-y-2 border-t border-line pt-3 text-sm font-semibold">
        {o.two_step && o.active && (
          <button type="button" className="text-primary" onClick={() => run('admin_reset_officer_two_step', { p_officer: o.user_id }, 'admin.resetConfirm')}>
            {t('admin.resetTwoStep')}
          </button>
        )}
        {o.active ? (
          <button
            type="button"
            className="text-danger"
            onClick={() => run('admin_set_officer_active', { p_officer: o.user_id, p_active: false }, 'admin.disableConfirm')}
          >
            {t('admin.disable')}
          </button>
        ) : (
          <button
            type="button"
            className="text-primary"
            onClick={() => run('admin_set_officer_active', { p_officer: o.user_id, p_active: true }, 'admin.enableConfirm')}
          >
            {t('admin.enable')}
          </button>
        )}
      </div>
      <ErrorText code={error} />
    </article>
  )
}

/** Invited but not signed in yet: resend the invitation. */
function WaitingCard({ officer: o }: { officer: Officer }) {
  const { t, lang } = useI18n()
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function resend() {
    setState('busy')
    setError(null)
    const { error } = await inviteOfficer(o.email)
    setState(error ? 'idle' : 'sent')
    if (error) setError(error)
  }

  return (
    <div className="card flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="break-all font-medium">{o.email}</p>
        <p className="text-sm text-muted">{t('admin.invitedOn').replace('{d}', dateText(o.invited_at, lang))}</p>
        <ErrorText code={error} />
      </div>
      <button type="button" className="btn-ghost shrink-0 sm:w-auto" disabled={state !== 'idle'} onClick={resend}>
        {state === 'sent' ? t('admin.resent') : t('admin.resend')}
      </button>
    </div>
  )
}
