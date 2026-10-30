import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { db, errorCode } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { displayMyPhone } from '../lib/phone'
import { addDays, dayKey, formatDate, formatTime, todayKey } from '../lib/time'
import { Icon } from '../components/icons'
import { buildWorkbook, downloadBlob, type AppointmentRow, type StudentRow } from '../lib/xlsx-export'
import { ErrorText, Loading } from '../components/Layout'

type ListRow = {
  id: string
  student_no: string
  full_name: string
  class_name: string
  school_name: string
  gender: string
  date_of_birth: string
  mykid_last4: string
  parent_name: string | null
  parent_phone: string | null
  upcoming: number
  next_at: string | null
}

// ------------------------------------------------------------- Student list

export function StudentsTab() {
  const { t, lang } = useI18n()
  const [rows, setRows] = useState<ListRow[] | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    setRows(null)
    db()
      .rpc('officer_students')
      .then(({ data }) => setRows((data as ListRow[]) ?? []))
  }, [])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q || !rows) return rows ?? []
    return rows.filter((r) => [r.full_name, r.student_no, r.class_name, r.school_name, r.parent_name ?? ''].some((v) => v.toLowerCase().includes(q)))
  }, [rows, query])

  if (!rows) return <Loading />

  const withBooking = rows.filter((r) => r.upcoming > 0).length

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Tile value={rows.length} label={t('stu.total')} />
        <Tile value={withBooking} label={t('stu.withBooking')} />
      </div>

      <input
        className="field"
        type="search"
        placeholder={t('stu.search')}
        aria-label={t('stu.search')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {rows.length === 0 && <p className="card text-sm text-muted">{t('stu.none')}</p>}
      {rows.length > 0 && shown.length === 0 && <p className="card text-sm text-muted">{t('stu.noMatch')}</p>}

      {shown.length > 0 && (
        <div className="overflow-x-auto rounded-[var(--radius-card)] bg-surface shadow-[0_8px_24px_rgba(31,52,110,0.06)]">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3 font-semibold">{t('stu.colId')}</th>
                <th className="px-4 py-3 font-semibold">{t('stu.colName')}</th>
                <th className="px-4 py-3 font-semibold">{t('stu.colClass')}</th>
                <th className="px-4 py-3 font-semibold">{t('stu.colParent')}</th>
                <th className="px-4 py-3 font-semibold">{t('stu.colNext')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0 hover:bg-page">
                  <td className="whitespace-nowrap px-4 py-3 font-semibold tracking-wide">{r.student_no}</td>
                  <td className="px-4 py-3">
                    <Link className="font-semibold text-primary" to={`/officer/student/${r.id}`}>
                      {r.full_name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{r.class_name}<span className="block text-xs text-muted">{r.school_name}</span></td>
                  <td className="px-4 py-3">
                    {r.parent_name ?? '—'}
                    {r.parent_phone && <span className="block text-xs text-muted">{displayMyPhone(r.parent_phone)}</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {r.next_at ? (
                      <>
                        {formatDate(r.next_at, lang).replace(/^[^,]+, /, '')}
                        <span className="block text-xs text-muted">{formatTime(r.next_at, lang)}</span>
                      </>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Tile({ value, label }: { value: number; label: string }) {
  return (
    <div className="card">
      <p className="text-3xl font-bold text-primary">{value}</p>
      <p className="text-sm text-muted">{label}</p>
    </div>
  )
}

// ---------------------------------------------------------- Patient profile

type Profile = {
  student: {
    id: string
    student_no: string
    full_name: string
    class_name: string
    gender: 'male' | 'female'
    date_of_birth: string
    mykid_last4: string
    blood_group: string | null
    height_cm: number | null
    weight_kg: number | null
    allergies: string | null
    conditions: string | null
    medications: string | null
    emergency_contact_name: string | null
    emergency_contact_phone: string | null
    school_name: string
  }
  guardians: Array<{
    relationship: string
    full_name: string | null
    phone: string | null
    email: string | null
    address_line1: string | null
    address_line2: string | null
    postcode: string | null
    city: string | null
    state: string | null
  }>
  appointments: Array<{
    id: string
    status: 'booked' | 'cancelled' | 'completed' | 'no_show'
    starts_at: string
    type_ms: string
    type_en: string
    note: string | null
    cancel_reason: string | null
  }>
}

function ageYears(dob: string): number {
  const [y, m, d] = dob.split('-').map(Number)
  const [ty, tm, td] = todayKey().split('-').map(Number)
  return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0)
}

/** Kid profile preview: who, which visit, call/message the parent, mark the visit, then everything on file. Viewing is logged. */
export function StudentProfile() {
  const { t, lang } = useI18n()
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const apptId = params.get('appointment')
  const [data, setData] = useState<Profile | null | undefined>(undefined)
  const [mykid, setMykid] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    db()
      .rpc('officer_student_profile', { p_student: id })
      .then(({ data, error }) => setData(error ? null : (data as Profile)))
  }, [id])

  // The full MyKid is fetched only on request (each reveal is logged) and hides again after a minute.
  async function reveal() {
    setError(null)
    const { data, error } = await db().rpc('reveal_mykid', { p_student: id })
    if (error) return setError(errorCode(error))
    setMykid(data as string)
    window.setTimeout(() => setMykid(null), 60_000)
  }

  async function setOutcome(status: 'booked' | 'completed' | 'no_show') {
    if (!apptId) return
    setBusy(true)
    setError(null)
    const { error } = await db().rpc('set_appointment_outcome', { p_appointment: apptId, p_status: status })
    setBusy(false)
    if (error) return setError(errorCode(error))
    setData((d) => (d ? { ...d, appointments: d.appointments.map((a) => (a.id === apptId ? { ...a, status } : a)) } : d))
  }

  // Back goes to where the officer came from: the day list or the student list.
  const back =
    params.get('from') === 'calendar'
      ? `/officer?s=calendar${params.get('day') ? `&day=${params.get('day')}` : ''}`
      : `/officer?s=students`

  if (data === undefined) return <Loading />
  if (data === null) {
    return (
      <div className="space-y-4">
        <BackLink to={back} />
        <p className="card text-sm text-muted">{t('pat.notFound')}</p>
      </div>
    )
  }

  const s = data.student
  const dash = '—'
  const appt = apptId ? data.appointments.find((a) => a.id === apptId) : undefined
  const parent = data.guardians[0]
  const waNumber = parent?.phone?.replace('+', '')

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-3">
        <Link
          to={back}
          aria-label={t('common.back')}
          className="grid h-11 w-11 place-items-center rounded-2xl bg-surface shadow-[0_4px_14px_rgba(31,52,110,0.06)]"
        >
          <Icon name="back" />
        </Link>
        <h1 className="text-xl font-bold">{t('pat.title')}</h1>
      </div>

      <section className="card space-y-4">
        <div className="flex items-center gap-4">
          <div className="grid h-20 w-20 shrink-0 place-items-center rounded-full bg-primary-soft text-3xl font-bold text-primary">
            {s.full_name.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-xl font-bold">{s.full_name}</h2>
              {appt && appt.status !== 'cancelled' && (
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusClass(appt.status)}`}>{t(`pat.status.${appt.status}`)}</span>
              )}
            </div>
            <p className="text-sm text-muted">
              {s.class_name} · {s.school_name}
            </p>
            <p className="text-sm font-semibold tracking-wide">{s.student_no}</p>
            {appt && (
              <p className="mt-1 flex items-center gap-1.5 text-sm text-primary">
                <Icon name="clock" className="h-4 w-4" />
                {formatDate(appt.starts_at, lang)}, {formatTime(appt.starts_at, lang)}
              </p>
            )}
          </div>
        </div>

        {parent?.phone && (
          <div className="grid grid-cols-2 gap-3">
            <a href={`tel:${parent.phone}`} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-accent-soft px-4 font-semibold text-accent">
              <Icon name="phone" className="h-5 w-5" />
              {t('pat.call')}
            </a>
            <a
              href={`https://wa.me/${waNumber}`}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-accent-soft px-4 font-semibold text-accent"
            >
              <Icon name="message" className="h-5 w-5" />
              {t('pat.message')}
            </a>
          </div>
        )}
      </section>

      {appt && (
        <Section title={t('pat.thisAppt')}>
          <Field label={t('book.whatFor')} value={lang === 'en' ? appt.type_en : appt.type_ms} />
          <Field label={t('book.date')} value={formatDate(appt.starts_at, lang)} />
          <Field label={t('book.at')} value={formatTime(appt.starts_at, lang)} />
          {appt.note && <Field label={t('cal.note')} value={appt.note} block />}
          {appt.status !== 'cancelled' && (
            <div className="space-y-2 pt-1">
              {appt.status === 'booked' ? (
                <div className="grid grid-cols-2 gap-3">
                  <button className="btn-primary" disabled={busy} onClick={() => setOutcome('completed')}>
                    {t('pat.markDone')}
                  </button>
                  <button className="btn-ghost text-danger" disabled={busy} onClick={() => setOutcome('no_show')}>
                    {t('pat.markNoShow')}
                  </button>
                </div>
              ) : (
                <button className="btn-ghost" disabled={busy} onClick={() => setOutcome('booked')}>
                  {t('pat.undo')}
                </button>
              )}
              <ErrorText code={error} />
            </div>
          )}
        </Section>
      )}

      <Section title={t('pat.info')}>
        <Field label={t('child.dob')} value={`${formatDate(`${s.date_of_birth}T04:00:00Z`, lang)} (${ageYears(s.date_of_birth)} ${t('pat.age')})`} />
        <Field label={t('child.gender')} value={s.gender === 'male' ? t('child.male') : t('child.female')} />
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted">{t('child.mykid')}</span>
          <span className="flex items-center gap-3 whitespace-nowrap font-medium">
            {mykid ?? `******-**-${s.mykid_last4}`}
            {mykid ? (
              <button className="text-primary" onClick={() => setMykid(null)}>
                {t('pat.hide')}
              </button>
            ) : (
              <button className="text-primary" onClick={reveal} title={t('pat.reveal')}>
                {t('pat.revealShort')}
              </button>
            )}
          </span>
        </div>
        {!appt && <ErrorText code={error} />}
        <p className="text-xs text-muted">{t('pat.revealNote')}</p>
      </Section>

      <Section title={t('pat.health')}>
        <Field label={t('kid.blood')} value={s.blood_group ?? dash} />
        <Field label={t('kid.height')} value={s.height_cm == null ? dash : String(s.height_cm)} />
        <Field label={t('kid.weight')} value={s.weight_kg == null ? dash : String(s.weight_kg)} />
        <Field label={t('kid.allergies')} value={s.allergies ?? dash} block />
        <Field label={t('kid.conditions')} value={s.conditions ?? dash} block />
        <Field label={t('kid.medications')} value={s.medications ?? dash} block />
      </Section>

      <Section title={t('pat.emergency')}>
        <Field label={t('kid.emName')} value={s.emergency_contact_name ?? dash} />
        <Field label={t('kid.emPhone')} value={s.emergency_contact_phone ? displayMyPhone(s.emergency_contact_phone) : dash} />
      </Section>

      <Section title={t('pat.guardians')}>
        {data.guardians.map((g, i) => {
          const address = [g.address_line1, g.address_line2, [g.postcode, g.city].filter(Boolean).join(' '), g.state].filter(Boolean)
          return (
            <div key={i} className="space-y-1 rounded-2xl bg-page p-3 text-sm">
              <p className="font-semibold">
                {g.full_name ?? dash} <span className="font-normal text-muted">· {t(`child.${g.relationship}`)}</span>
              </p>
              {g.phone && (
                <p>
                  <a className="text-primary" href={`tel:${g.phone}`}>
                    {displayMyPhone(g.phone)}
                  </a>
                </p>
              )}
              {g.email && (
                <p>
                  <a className="break-all text-primary" href={`mailto:${g.email}`}>
                    {g.email}
                  </a>
                </p>
              )}
              <p className="pt-1 text-xs text-muted">{t('pat.address')}</p>
              {address.length > 0 ? address.map((line, n) => <p key={n}>{line}</p>) : <p className="text-muted">{t('pat.noAddress')}</p>}
            </div>
          )
        })}
      </Section>

      <Section title={t('pat.history')}>
        {data.appointments.length === 0 && <p className="text-sm text-muted">{t('pat.noHistory')}</p>}
        {data.appointments.map((a) => (
          <div key={a.id} className="rounded-2xl bg-page p-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <p className="font-semibold">{lang === 'en' ? a.type_en : a.type_ms}</p>
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusClass(a.status)}`}>{t(`pat.status.${a.status}`)}</span>
            </div>
            <p className="text-muted">
              {formatDate(a.starts_at, lang)}, {formatTime(a.starts_at, lang)}
            </p>
            {a.note && (
              <p className="mt-1">
                <span className="text-muted">{t('cal.note')}:</span> {a.note}
              </p>
            )}
            {a.cancel_reason && <p className="mt-1 text-danger">{a.cancel_reason}</p>}
          </div>
        ))}
      </Section>
    </div>
  )
}

const statusClass = (status: string) =>
  status === 'booked' ? 'bg-amber-100 text-amber-700' : status === 'completed' ? 'bg-success/15 text-success' : 'bg-danger/10 text-danger'

function BackLink({ to }: { to: string }) {
  const { t } = useI18n()
  return (
    <Link to={to} className="inline-flex items-center gap-2 text-sm font-semibold text-primary">
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M19 12H5M12 19l-7-7 7-7" />
      </svg>
      {t('common.back')}
    </Link>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card space-y-3">
      <h2 className="text-base font-bold">{title}</h2>
      {children}
    </section>
  )
}

function Field({ label, value, block = false }: { label: string; value: string; block?: boolean }) {
  return block ? (
    <div className="text-sm">
      <p className="text-muted">{label}</p>
      <p className="whitespace-pre-wrap font-medium">{value}</p>
    </div>
  ) : (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-muted">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  )
}

// ------------------------------------------------------------- Excel export


export function ExportTab() {
  const { t, lang } = useI18n()
  const [withStudents, setWithStudents] = useState(true)
  const [withAppts, setWithAppts] = useState(true)
  const [includeMykid, setIncludeMykid] = useState(false)
  const monthStart = `${todayKey().slice(0, 8)}01`
  const [from, setFrom] = useState(monthStart)
  const [to, setTo] = useState(addDays(todayKey(), 60))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const download = useCallback(async () => {
    setError(null)
    setMessage(null)
    if (!withStudents && !withAppts) return setError('pick_one')
    if (withStudents && includeMykid && !window.confirm(t('exp.mykidConfirm'))) return

    setBusy(true)
    try {
      let students: StudentRow[] | undefined
      let appointments: AppointmentRow[] | undefined
      if (withStudents) {
        const { data, error } = await db().rpc('export_students', { p_include_mykid: includeMykid })
        if (error) throw error
        students = data as StudentRow[]
      }
      if (withAppts) {
        const { data, error } = await db().rpc('export_appointments', { p_from: from, p_to: to })
        if (error) throw error
        appointments = data as AppointmentRow[]
      }
      const blob = await buildWorkbook({ lang, students, appointments, includeMykid: withStudents && includeMykid })
      downloadBlob(blob, `vaksin-${dayKey(new Date())}.xlsx`)
      setMessage(
        t('exp.done')
          .replace('{s}', String(students?.length ?? 0))
          .replace('{a}', String(appointments?.length ?? 0)),
      )
    } catch (e) {
      setError(errorCode(e))
    } finally {
      setBusy(false)
    }
  }, [withStudents, withAppts, includeMykid, from, to, lang, t])

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <section className="card space-y-4">
        <h2 className="text-lg font-bold">{t('exp.title')}</h2>
        <p className="text-sm text-muted">{t('exp.mine')}</p>

        <fieldset className="space-y-3">
          <legend className="label">{t('exp.what')}</legend>
          <Check checked={withStudents} onChange={setWithStudents} label={t('exp.students')} />
          <Check checked={withAppts} onChange={setWithAppts} label={t('exp.appts')} />
        </fieldset>

        {withAppts && (
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="label">{t('exp.from')}</span>
              <input className="field" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="block">
              <span className="label">{t('exp.to')}</span>
              <input className="field" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>
        )}

        {withStudents && (
          <div className="space-y-2 rounded-2xl bg-page p-3">
            <Check checked={includeMykid} onChange={setIncludeMykid} label={t('exp.mykid')} />
            <p className="text-xs text-muted">{t('exp.mykidWarn')}</p>
          </div>
        )}

        <ErrorText code={error} />
        {message && <p className="text-sm font-medium text-success">{message}</p>}
        <button className="btn-primary" disabled={busy || (!withStudents && !withAppts)} onClick={download}>
          {busy ? t('exp.working') : t('exp.download')}
        </button>
        <p className="text-xs text-muted">{t('exp.sensitive')}</p>
      </section>
    </div>
  )
}

function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-start gap-3 text-sm">
      <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-primary" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}
