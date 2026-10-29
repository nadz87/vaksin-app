import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { db, errorCode } from '../lib/api'
import { changePassword, enrollMfa, passwordSignIn, verifyMfa } from '../lib/auth-client'
import { useAuth } from '../lib/auth'
import { useI18n } from '../lib/i18n'
import { Centered, ErrorText, Loading } from '../components/Layout'
import type { CalSchool } from './officer-calendar'
import { StudentsTab } from './officer-students'
import { CalendarScreen, HomeScreen } from './officer-dashboard'
import { SETTINGS_VIEWS, SettingsScreen } from './officer-settings'
import { Icon, type IconName } from '../components/icons'

type School = { id: string; name: string; slug: string; state: string | null }

/**
 * Officer and platform-admin pages sit behind this gate:
 * password sign-in, then 2-step verification (database rules require aal2).
 */
export function StaffGate({ allow, children }: { allow: Array<'officer' | 'platform_admin'>; children: ReactNode }) {
  const { t } = useI18n()
  const { loading, session, profile, aal, mustChangePassword } = useAuth()

  if (loading) return <Loading />
  if (!session) return <PasswordSignIn />
  if (mustChangePassword) return <ChangePassword />
  if (!profile || !allow.includes(profile.role as 'officer' | 'platform_admin')) {
    return (
      <Centered>
        <p>{t('officer.notOfficer')}</p>
      </Centered>
    )
  }
  if (aal !== 'aal2') return <TwoStep />
  return <>{children}</>
}

function PasswordSignIn() {
  const { t } = useI18n()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await passwordSignIn(email.trim(), password)
    setBusy(false)
    if (error) setError(error)
  }

  return (
    <Centered>
      <form onSubmit={submit} className="space-y-4">
        <h2 className="text-xl font-bold">{t('officer.title')}</h2>
        <label className="block">
          <span className="label">{t('signin.email')}</span>
          <input className="field" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">{t('officer.password')}</span>
          <input className="field" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <ErrorText code={error} />
        <button className="btn-primary" disabled={busy}>
          {t('officer.signin')}
        </button>
      </form>
    </Centered>
  )
}

/** First sign-in with a temporary password: choose a new one before anything else. */
function ChangePassword() {
  const { t } = useI18n()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (next.length < 12) return setError('weak_password')
    if (next !== again) return setError('password_mismatch')
    setBusy(true)
    const { error } = await changePassword(current, next)
    setBusy(false)
    if (error) setError(error)
  }

  return (
    <Centered>
      <form onSubmit={submit} className="space-y-4">
        <h2 className="text-xl font-bold">{t('pw.title')}</h2>
        <p className="text-sm text-muted">{t('pw.body')}</p>
        <label className="block">
          <span className="label">{t('pw.current')}</span>
          <input className="field" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">{t('pw.new')}</span>
          <input className="field" type="password" autoComplete="new-password" minLength={12} required value={next} onChange={(e) => setNext(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">{t('pw.confirm')}</span>
          <input className="field" type="password" autoComplete="new-password" minLength={12} required value={again} onChange={(e) => setAgain(e.target.value)} />
        </label>
        <ErrorText code={error} />
        <button className="btn-primary" disabled={busy}>
          {t('pw.save')}
        </button>
      </form>
    </Centered>
  )
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

  useEffect(() => {
    db()
      .from('schools')
      .select('id, name, weekend_days')
      .order('name')
      .then(({ data }) => setSchools((data as CalSchool[]) ?? []))
  }, [])

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

      {schools.length === 0 && <p className="card text-muted">{t('officer.noSchools')}</p>}

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
        />
      )}
    </div>
  )
}

/** iMotion platform admin: create schools, share links, assign the officer. */
export function AdminSchools() {
  const { t } = useI18n()
  const [schools, setSchools] = useState<School[] | null>(null)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [state, setState] = useState('')
  const [weekend, setWeekend] = useState('6,7')
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const { data } = await db().from('schools').select('id, name, slug, state').order('name')
    setSchools((data as School[]) ?? [])
  }
  useEffect(() => {
    load()
  }, [])

  async function create(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const { error } = await db()
      .from('schools')
      .insert({ name: name.trim(), slug: slug.trim().toLowerCase(), state: state.trim() || null, weekend_days: weekend.split(',').map(Number) })
    if (error) return setError('generic')
    setName('')
    setSlug('')
    setState('')
    load()
  }

  if (!schools) return <Loading />

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t('admin.title')}</h1>

      <form onSubmit={create} className="card grid gap-3 sm:grid-cols-2">
        <h2 className="font-semibold sm:col-span-2">{t('admin.newSchool')}</h2>
        <label className="block">
          <span className="label">{t('admin.name')}</span>
          <input className="field" required value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">{t('admin.slug')}</span>
          <input className="field" required pattern="[a-z0-9-]{3,40}" value={slug} onChange={(e) => setSlug(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">{t('admin.state')}</span>
          <input className="field" value={state} onChange={(e) => setState(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">{t('admin.weekend')}</span>
          <select className="field" value={weekend} onChange={(e) => setWeekend(e.target.value)}>
            <option value="6,7">{t('admin.weekendSatSun')}</option>
            <option value="5,6">{t('admin.weekendFriSat')}</option>
          </select>
        </label>
        <div className="sm:col-span-2">
          <ErrorText code={error} />
          <button className="btn-primary mt-2 sm:w-auto">{t('admin.create')}</button>
        </div>
      </form>

      <h2 className="font-semibold text-muted">{t('admin.schools')}</h2>
      <div className="space-y-4">
        {schools.map((s) => (
          <AdminSchoolCard key={s.id} school={s} />
        ))}
      </div>
    </div>
  )
}

function AdminSchoolCard({ school }: { school: School }) {
  const { t } = useI18n()
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const link = `${location.origin}${import.meta.env.BASE_URL}#/s/${school.slug}`

  async function assign(e: FormEvent) {
    e.preventDefault()
    setMsg(null)
    setError(null)
    const { error } = await db().rpc('admin_assign_officer', { p_email: email, p_school: school.id })
    if (error) return setError(errorCode(error))
    setEmail('')
    setMsg(t('admin.assigned'))
  }

  return (
    <div className="card space-y-3">
      <p className="font-semibold">{school.name}</p>
      <p className="text-sm">
        <span className="text-muted">{t('admin.link')}: </span>
        <a className="break-all text-primary" href={link}>
          {link}
        </a>
      </p>
      <form onSubmit={assign} className="flex flex-col gap-2 sm:flex-row">
        <input
          className="field"
          type="email"
          placeholder={t('admin.assignOfficer')}
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button className="btn-ghost sm:w-auto">{t('admin.assign')}</button>
      </form>
      {msg && <p className="text-sm text-success">{msg}</p>}
      <ErrorText code={error} />
    </div>
  )
}
