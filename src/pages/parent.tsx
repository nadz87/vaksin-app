import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router'
import { db, errorCode } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useI18n } from '../lib/i18n'
import { formatMyKid, parseMyKid } from '../lib/mykid'
import { formatDate, formatTime } from '../lib/time'
import { displayMyPhone, normalizeMyPhone } from '../lib/phone'
import { MY_STATES } from '../lib/states'
import { EmailSignIn } from '../components/EmailSignIn'
import { Centered, ErrorText, Loading } from '../components/Layout'

type School = { id: string; name: string; slug: string; logo_url?: string | null }
type Place = { id: string; name: string; slug: string; address: string | null }
type PickSchool = School & { level: 'rendah' | 'menengah'; state: string | null }
type Child = { id: string; full_name: string; class_name: string; mykid_last4: string; school_id: string; student_no: string }

/** "/" for someone who is not signed in and has no clinic link. */
export function Welcome() {
  const { t } = useI18n()
  return (
    <div className="space-y-4">
      <p className="text-muted">{t('app.tagline')}</p>
      <Centered>
        <p className="text-sm text-muted">{t('welcome.body')}</p>
        <EmailSignIn />
      </Centered>
    </div>
  )
}

/**
 * "/s/:slug" is the clinic link officers share with parents (Klinik Kesihatan Putrajaya P18
 * is /s/kkp18). Any parent can book there; the child's school is set on the child's profile.
 * Older school links (shared before 2026-10-30) still land here and simply open the sign-in.
 */
export function ClinicLanding() {
  const { slug = '' } = useParams()
  const { t } = useI18n()
  const { session, profile, loading, signOut } = useAuth()
  const [place, setPlace] = useState<Place | null | undefined>(undefined)

  useEffect(() => {
    db()
      .from('locations')
      .select('id, name, slug, address')
      .eq('slug', slug)
      .then(({ data }) => setPlace((data as Place[] | null)?.[0] ?? null))
  }, [slug])

  if (loading || place === undefined || (session && !profile)) return <Loading />
  if (place === null) return <Navigate to="/" replace />
  // A staff account on this browser would otherwise be sent to its own page without a word.
  const staff = profile && profile.role !== 'parent'
  if (session && !staff) return <Navigate to="/" replace />

  return (
    <div className="space-y-4">
      <PlaceBadge place={place} />
      <Centered>
        {staff ? (
          <>
            <p className="text-sm text-muted">
              {t(profile.role === 'platform_admin' ? 'clinic.signedInAdmin' : 'clinic.signedInOfficer').replace('{e}', session?.user.email ?? '')}
            </p>
            <button className="btn-primary" onClick={() => signOut()}>
              {t('signout')}
            </button>
          </>
        ) : (
          <EmailSignIn />
        )}
      </Centered>
    </div>
  )
}

export function ParentHome() {
  const { t } = useI18n()
  const { session, profile } = useAuth()
  const [schools, setSchools] = useState<School[] | null>(null)
  const [children, setChildren] = useState<Child[]>([])

  useEffect(() => {
    Promise.all([
      db().from('schools').select('id, name, slug, logo_url').order('name'),
      db().from('students').select('id, full_name, class_name, mykid_last4, school_id, student_no').order('full_name'),
    ]).then(([s, c]) => {
      setSchools((s.data as School[]) ?? [])
      setChildren((c.data as Child[]) ?? [])
    })
  }, [])

  if (schools === null) return <Loading />

  return (
    <div className="space-y-5">
      <Link to="/profile" className="flex items-center justify-between gap-3 rounded-2xl py-1" aria-label={t('me.title')}>
        <span>
          <span className="block text-sm text-muted">{t('home.hello')}</span>
          <span className="block font-semibold">{profile?.full_name ?? session?.user.email}</span>
        </span>
        <span className="flex items-center gap-1 text-sm font-medium text-primary">
          {t('me.title')}
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </span>
      </Link>

      {children.length > 0 && (
        <MyAppointments>
          <Link to="/book" className="btn-primary">
            {t('home.book')}
          </Link>
        </MyAppointments>
      )}

      {children.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-bold">{t('home.children')}</h2>
          {children.map((kid) => (
            <div key={kid.id} className="card flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold">{kid.full_name}</p>
                <p className="text-sm text-muted">
                  {kid.class_name} · {schools.find((sc) => sc.id === kid.school_id)?.name}
                </p>
                <p className="text-xs font-semibold tracking-wide text-ink">{kid.student_no}</p>
                <p className="whitespace-nowrap text-xs text-muted">******-**-{kid.mykid_last4}</p>
              </div>
              <Link to={`/book?child=${kid.id}`} className="shrink-0 whitespace-nowrap text-sm font-semibold text-primary">
                {t('home.book')}
              </Link>
            </div>
          ))}
        </section>
      )}

      {children.length === 0 && (
        <Link to="/children/new" className="card block space-y-1 text-center">
          <span className="block text-sm text-muted">{t('home.noChildren')}</span>
          <span className="block font-semibold text-primary">+ {t('home.addChild')}</span>
        </Link>
      )}

      {children.length > 0 && (
        <div className="text-center text-sm font-medium text-primary">
          <Link to="/children/new">+ {t('home.addChild')}</Link>
        </div>
      )}
    </div>
  )
}

/** Parent profile: see and edit own name and mobile number; email is read-only. */
export function ParentProfile() {
  const { t } = useI18n()
  const { session, profile, refresh } = useAuth()
  const [fullName, setFullName] = useState(profile?.full_name ?? '')
  const [phone, setPhone] = useState(profile?.phone ? displayMyPhone(profile.phone) : '')
  const [addr1, setAddr1] = useState(profile?.address_line1 ?? '')
  const [addr2, setAddr2] = useState(profile?.address_line2 ?? '')
  const [postcode, setPostcode] = useState(profile?.postcode ?? '')
  const [city, setCity] = useState(profile?.city ?? '')
  const [stateName, setStateName] = useState(profile?.state ?? '')
  const [schools, setSchools] = useState<School[] | null>(null)
  const [children, setChildren] = useState<Child[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    Promise.all([
      db().from('schools').select('id, name, slug').order('name'),
      db().from('students').select('id, full_name, class_name, mykid_last4, school_id, student_no').order('full_name'),
    ]).then(([s, c]) => {
      setSchools((s.data as School[]) ?? [])
      setChildren((c.data as Child[]) ?? [])
    })
  }, [])

  const normalized = normalizeMyPhone(phone)
  const changed =
    fullName.trim() !== (profile?.full_name ?? '') ||
    normalized !== (profile?.phone ?? null) ||
    addr1.trim() !== (profile?.address_line1 ?? '') ||
    addr2.trim() !== (profile?.address_line2 ?? '') ||
    postcode.trim() !== (profile?.postcode ?? '') ||
    city.trim() !== (profile?.city ?? '') ||
    stateName !== (profile?.state ?? '')

  // Typing in any field clears the "saved" note.
  function typing(set: (v: string) => void, value: string) {
    set(value)
    setSaved(false)
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    setSaved(false)
    if (!normalized) return setError('invalid_phone')
    // Address is optional, but all-or-nothing: address, postcode, city and state go together.
    const parts = [addr1.trim(), postcode.trim(), city.trim(), stateName]
    const anyAddress = parts.some(Boolean) || addr2.trim() !== ''
    if (anyAddress && !parts.every(Boolean)) return setError('address_incomplete')
    if (anyAddress && !/^[0-9]{5}$/.test(postcode.trim())) return setError('invalid_postcode')
    setBusy(true)
    setError(null)
    const { error } = await db()
      .from('profiles')
      .update({
        full_name: fullName.trim(),
        phone: normalized,
        address_line1: addr1.trim() || null,
        address_line2: addr2.trim() || null,
        postcode: postcode.trim() || null,
        city: city.trim() || null,
        state: stateName || null,
      })
      .eq('user_id', profile!.user_id)
    setBusy(false)
    if (error) return setError('generic')
    await refresh()
    setSaved(true)
  }

  if (!schools) return <Loading />

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link
          to="/"
          aria-label={t('common.back')}
          className="grid h-11 w-11 place-items-center rounded-2xl bg-surface shadow-[0_4px_14px_rgba(31,52,110,0.06)]"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </Link>
        <h2 className="text-xl font-bold">{t('me.title')}</h2>
      </div>

      <div className="flex items-center gap-3">
        <div className="grid h-14 w-14 place-items-center rounded-full bg-primary-soft text-xl font-bold text-primary">
          {(profile?.full_name ?? session?.user.email ?? '?').slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="truncate font-semibold">{profile?.full_name}</p>
          <p className="truncate text-sm text-muted">{session?.user.email}</p>
        </div>
      </div>

      <form onSubmit={save} className="card space-y-4">
        <label className="block">
          <span className="label">{t('profile.fullName')}</span>
          <input
            className="field"
            autoComplete="name"
            required
            minLength={2}
            value={fullName}
            onChange={(e) => {
              setFullName(e.target.value)
              setSaved(false)
            }}
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
            onChange={(e) => {
              setPhone(e.target.value)
              setSaved(false)
            }}
          />
        </label>
        <fieldset className="space-y-4 border-t border-line pt-4">
          <legend className="text-base font-bold">{t('me.address')}</legend>
          <p className="-mt-1 text-xs text-muted">{t('me.addressHint')}</p>
          <label className="block">
            <span className="label">{t('me.addr1')}</span>
            <input
              className="field"
              autoComplete="address-line1"
              maxLength={150}
              value={addr1}
              onChange={(e) => typing(setAddr1, e.target.value)}
            />
          </label>
          <label className="block">
            <span className="label">{t('me.addr2')}</span>
            <input
              className="field"
              autoComplete="address-line2"
              maxLength={150}
              value={addr2}
              onChange={(e) => typing(setAddr2, e.target.value)}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="label">{t('me.postcode')}</span>
              <input
                className="field"
                inputMode="numeric"
                autoComplete="postal-code"
                maxLength={5}
                value={postcode}
                onChange={(e) => typing(setPostcode, e.target.value.replace(/\D/g, ''))}
              />
            </label>
            <label className="block">
              <span className="label">{t('me.city')}</span>
              <input
                className="field"
                autoComplete="address-level2"
                maxLength={80}
                value={city}
                onChange={(e) => typing(setCity, e.target.value)}
              />
            </label>
          </div>
          <label className="block">
            <span className="label">{t('me.state')}</span>
            <select
              className="field"
              autoComplete="address-level1"
              value={stateName}
              onChange={(e) => typing(setStateName, e.target.value)}
            >
              <option value="" />
              {MY_STATES.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
        <label className="block">
          <span className="label">{t('me.email')}</span>
          <input className="field bg-page text-muted" value={session?.user.email ?? ''} readOnly disabled />
          <span className="mt-1 block text-xs text-muted">{t('me.emailHint')}</span>
        </label>
        <ErrorText code={error} />
        {saved && <p className="text-sm font-medium text-success">{t('me.saved')}</p>}
        <button className="btn-primary" disabled={busy || !changed || fullName.trim().length < 2}>
          {t('me.save')}
        </button>
      </form>

      <section className="space-y-2">
        <h3 className="text-lg font-bold">{t('me.children')}</h3>
        {children.length === 0 && <p className="card text-sm text-muted">{t('me.noChildren')}</p>}
        {children.map((kid) => (
          <Link key={kid.id} to={`/children/${kid.id}`} className="card flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold">{kid.full_name}</p>
              <p className="text-sm text-muted">
                {kid.class_name} · {schools.find((sc) => sc.id === kid.school_id)?.name}
              </p>
              <p className="text-xs text-muted">
                {t('child.studentNo')}: <span className="font-semibold tracking-wide text-ink">{kid.student_no}</span>
              </p>
            </div>
            <span className="flex shrink-0 items-center gap-1 text-sm font-semibold text-primary">
              {t('kid.edit')}
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </span>
          </Link>
        ))}
      </section>

      <p className="text-center text-xs text-muted">{t('me.privacy')}</p>
    </div>
  )
}

type MyAppt = {
  id: string
  student_id: string
  status: 'booked' | 'cancelled' | 'completed' | 'no_show'
  starts_at: string
  student_name: string
  school_name: string
  location_name: string
  type_id: string
  type_name_ms: string
  type_name_en: string
  can_cancel: boolean
  cancel_reason: string | null
  cancelled_by_officer: boolean
  child_profile_complete: boolean
}

/**
 * Notices first (appointments the officer cancelled, until the child is booked again for that
 * type or the time passes), then `children` (the book button), then upcoming bookings with
 * cancel until 24h before and a reminder while the child's health profile is incomplete.
 */
function MyAppointments({ children }: { children: ReactNode }) {
  const { t, lang } = useI18n()
  const [items, setItems] = useState<MyAppt[] | null>(null)

  const load = useCallback(async () => {
    const { data } = await db().rpc('my_appointments')
    const now = Date.now()
    // Upcoming bookings, plus upcoming ones the officer had to cancel (so parents notice).
    setItems(
      ((data as MyAppt[]) ?? []).filter(
        (a) => new Date(a.starts_at).getTime() > now && (a.status === 'booked' || (a.status === 'cancelled' && a.cancelled_by_officer)),
      ),
    )
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (!items) return <>{children}</>

  const booked = items.filter((a) => a.status === 'booked')
  const notices = items.filter(
    (a) => a.status === 'cancelled' && !booked.some((b) => b.student_id === a.student_id && b.type_id === a.type_id),
  )

  return (
    <>
      {notices.map((a) => (
        <section key={a.id} role="status" className="space-y-2 rounded-2xl border border-danger/30 bg-danger/5 p-4">
          <p className="font-semibold text-danger">{t('mine.cancelledByOfficer')}</p>
          <p className="text-sm">
            <span className="font-semibold">{lang === 'en' ? a.type_name_en : a.type_name_ms}</span> · {a.student_name}
            <br />
            {formatDate(a.starts_at, lang)}, {formatTime(a.starts_at, lang)} · {a.location_name}
          </p>
          {a.cancel_reason && <p className="text-sm text-muted">{a.cancel_reason}</p>}
          <p className="text-sm">{t('mine.pickNewBody')}</p>
          <Link to={`/book?child=${a.student_id}`} className="btn-primary">
            {t('mine.rebook')}
          </Link>
        </section>
      ))}
      {children}
      <section className="space-y-3">
        <h2 className="text-lg font-bold">{t('mine.title')}</h2>
        {booked.length === 0 && <p className="card text-sm text-muted">{t('mine.none')}</p>}
        {booked.map((a) => (
        <div key={a.id} className="card space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold">{lang === 'en' ? a.type_name_en : a.type_name_ms}</p>
              <p className="text-sm text-muted">
                {a.student_name} · {a.school_name}
              </p>
              <p className="text-sm text-muted">{a.location_name}</p>
            </div>
            <Link to={`/cancel?appointment=${a.id}`} className="shrink-0 text-sm font-semibold text-danger">
              {t('mine.cancelShort')}
            </Link>
          </div>
          <p className="text-sm font-medium text-primary">
            {formatDate(a.starts_at, lang)}, {formatTime(a.starts_at, lang)}
          </p>
          {!a.child_profile_complete && (
            <Link to={`/children/${a.student_id}`} className="inline-flex items-center gap-1 text-sm font-semibold text-danger">
              {t('mine.completeProfile')}
              <span aria-hidden="true">›</span>
            </Link>
          )}
        </div>
        ))}
      </section>
    </>
  )
}

/** "Batalkan temujanji": upcoming bookings, each cancellable until 24 hours before. */
export function CancelAppointments() {
  const { t, lang } = useI18n()
  const [params] = useSearchParams()
  const apptId = params.get('appointment')
  const [items, setItems] = useState<MyAppt[] | null>(null)
  // Coming from a card's red "Batalkan": that appointment's reason panel is already open.
  const [openId, setOpenId] = useState<string | null>(apptId)
  const [reasonKey, setReasonKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const load = useCallback(async () => {
    const { data } = await db().rpc('my_appointments')
    const now = Date.now()
    setItems(((data as MyAppt[]) ?? []).filter((a) => a.status === 'booked' && new Date(a.starts_at).getTime() > now))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function cancel(id: string) {
    setBusy(true)
    setError(null)
    const { error } = await db().rpc('cancel_appointment', {
      p_appointment: id,
      p_reason: reasonKey ? t(reasonKey) : null,
    })
    setBusy(false)
    if (error) {
      setError(errorCode(error))
      return load()
    }
    setOpenId(null)
    setReasonKey('')
    setDone(true)
    load()
  }

  if (!items) return <Loading />

  // From a card: only that appointment (after cancelling it, the list is empty by design).
  const shown = apptId ? items.filter((a) => a.id === apptId) : items

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link
          to="/"
          aria-label={t('common.back')}
          className="grid h-11 w-11 place-items-center rounded-2xl bg-surface shadow-[0_4px_14px_rgba(31,52,110,0.06)]"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </Link>
        <h2 className="text-xl font-bold">{t('cancel.menu')}</h2>
      </div>

      {done && (
        <div className="card space-y-3">
          <p className="font-medium text-success">{t('cancel.done')}</p>
          <Link to="/book" className="btn-ghost">
            {t('mine.rebook')}
          </Link>
        </div>
      )}

      <ErrorText code={error} />

      {shown.length === 0 ? (
        !done && <p className="card text-sm text-muted">{t('cancel.none')}</p>
      ) : (
        <p className="text-sm text-muted">{t('cancel.body')}</p>
      )}

      {shown.map((a) => (
        <div key={a.id} className="card space-y-3">
          <div>
            <p className="font-semibold">{lang === 'en' ? a.type_name_en : a.type_name_ms}</p>
            <p className="text-sm text-muted">
              {a.student_name} · {a.school_name}
            </p>
            <p className="text-sm text-muted">{a.location_name}</p>
            <p className="text-sm font-medium text-primary">
              {formatDate(a.starts_at, lang)}, {formatTime(a.starts_at, lang)}
            </p>
          </div>

          {!a.can_cancel && <p className="text-sm text-muted">{t('mine.cancelLocked')}</p>}

          {a.can_cancel && openId !== a.id && (
            <button
              className="btn-ghost text-danger"
              onClick={() => {
                setOpenId(a.id)
                setReasonKey('')
                setDone(false)
              }}
            >
              {t('cancel.menu')}
            </button>
          )}

          {a.can_cancel && openId === a.id && (
            <div className="space-y-3 rounded-2xl bg-page p-3">
              <p className="text-sm font-medium">{t('cancel.reasonTitle')}</p>
              <div className="flex flex-wrap gap-2">
                {['cancel.r1', 'cancel.r2', 'cancel.r3', 'cancel.r4'].map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={reasonKey === k}
                    onClick={() => setReasonKey(reasonKey === k ? '' : k)}
                    className={`rounded-full px-3 py-2 text-sm font-medium transition ${
                      reasonKey === k ? 'bg-primary text-white' : 'bg-surface text-ink'
                    }`}
                  >
                    {t(k)}
                  </button>
                ))}
              </div>
              <button className="btn-primary bg-danger hover:bg-danger/90" disabled={busy} onClick={() => cancel(a.id)}>
                {t('cancel.confirm')}
              </button>
              <button className="btn-ghost" disabled={busy} onClick={() => setOpenId(null)}>
                {t('cancel.keep')}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export function AddChild() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [allSchools, setAllSchools] = useState<PickSchool[] | null>(null)
  // Any school in the list; parents type their child's school here, nothing to join first.
  const [schoolId, setSchoolId] = useState(params.get('school') ?? '')

  useEffect(() => {
    db()
      .rpc('list_schools')
      .then(({ data }) => setAllSchools((data as PickSchool[]) ?? []))
  }, [])

  const [fullName, setFullName] = useState('')
  const [mykid, setMykid] = useState('')
  const [dob, setDob] = useState('')
  const [gender, setGender] = useState<'male' | 'female' | ''>('')
  const [className, setClassName] = useState('')
  const [relationship, setRelationship] = useState('mother')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  function onMykid(value: string) {
    const formatted = formatMyKid(value)
    setMykid(formatted)
    const info = parseMyKid(formatted)
    if (info) {
      setDob(info.dob)
      setGender(info.gender)
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { data, error } = await db().rpc('register_child', {
      p_school_id: schoolId,
      p_full_name: fullName,
      p_mykid: mykid,
      p_dob: dob,
      p_gender: gender,
      p_class_name: className,
      p_relationship: relationship,
      p_consent: consent,
    })
    setBusy(false)
    if (error) return setError(errorCode(error))
    const status = (data as { status: string }).status
    if (status === 'created') navigate('/', { replace: true })
    else setResult(status === 'request_pending' ? 'child.requestPending' : 'child.alreadyLinked')
  }

  if (!allSchools) return <Loading />

  if (result) {
    return (
      <Centered>
        <p>{t(result)}</p>
        <Link to="/" className="btn-primary">
          {t('common.back')}
        </Link>
      </Centered>
    )
  }

  const ready = schoolId && fullName.trim() && mykid.replace(/\D/g, '').length === 12 && dob && gender && className.trim() && consent

  return (
    <form onSubmit={submit} className="card space-y-4">
      <h2 className="text-xl font-bold">{t('child.title')}</h2>

      <label className="block">
        <span className="label">{t('child.school')}</span>
        <select className="field" required value={schoolId} onChange={(e) => setSchoolId(e.target.value)}>
          <option value="" disabled />
          {(['rendah', 'menengah'] as const).map((level) => (
            <optgroup key={level} label={t(`join.${level}`)}>
              {allSchools
                .filter((sc) => sc.level === level)
                .map((sc) => (
                  <option key={sc.id} value={sc.id}>
                    {sc.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="label">{t('child.fullName')}</span>
        <input className="field" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </label>

      <label className="block">
        <span className="label">{t('child.mykid')}</span>
        <input
          className="field tracking-wider"
          inputMode="numeric"
          placeholder="000000-00-0000"
          required
          value={mykid}
          onChange={(e) => onMykid(e.target.value)}
        />
        <span className="mt-1 block text-xs text-muted">{t('child.mykidHint')}</span>
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="label">{t('child.dob')}</span>
          <input className="field" type="date" required value={dob} onChange={(e) => setDob(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">{t('child.gender')}</span>
          <select
            className="field"
            required
            value={gender}
            onChange={(e) => setGender(e.target.value as 'male' | 'female')}
          >
            <option value="" disabled />
            <option value="male">{t('child.male')}</option>
            <option value="female">{t('child.female')}</option>
          </select>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="label">{t('child.class')}</span>
          <input className="field" required value={className} onChange={(e) => setClassName(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">{t('child.relationship')}</span>
          <select className="field" value={relationship} onChange={(e) => setRelationship(e.target.value)}>
            <option value="mother">{t('child.mother')}</option>
            <option value="father">{t('child.father')}</option>
            <option value="guardian">{t('child.guardian')}</option>
          </select>
        </label>
      </div>

      <label className="flex gap-3 rounded-[var(--radius-field)] bg-primary-soft p-4 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 h-5 w-5 shrink-0 accent-primary"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        <span>{t('child.consent')}</span>
      </label>

      <ErrorText code={error} />
      <button className="btn-primary" disabled={busy || !ready}>
        {t('child.save')}
      </button>
      <Link to="/" className="block text-center text-sm text-muted">
        {t('common.back')}
      </Link>
    </form>
  )
}

function PlaceBadge({ place }: { place: Place }) {
  const { t } = useI18n()
  return (
    <div className="flex items-center gap-3">
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent-soft font-bold text-accent">
        {place.name.slice(0, 2).toUpperCase()}
      </div>
      <div>
        <p className="text-xs text-muted">{t('loc.label')}</p>
        <p className="font-semibold">{place.name}</p>
        {place.address && <p className="text-sm text-muted">{place.address}</p>}
      </div>
    </div>
  )
}
