import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { db, errorCode } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { addDays, dayKey, formatDate, formatMonth, formatTime, isoWeekday, monthDays, shiftMonth, shortDate, tileLabel, todayKey, weekStart } from '../lib/time'
import { Icon } from '../components/icons'
import { ErrorText, Loading } from '../components/Layout'
import type { CalSchool } from './officer-calendar'

type Booking = {
  appointment_id: string
  status: 'booked' | 'completed' | 'no_show'
  student_id: string
  student_no: string
  student_name: string
  class_name: string
  type_ms: string
  type_en: string
  note: string | null
  parent_name: string | null
  parent_phone: string | null
}
type OSlot = {
  id: string
  starts_at: string
  ends_at: string
  capacity: number
  status: 'open' | 'blocked'
  appointment_type_id: string | null
  booked: number
  bookings: Booking[]
}
type Stats = {
  students_total: number
  students_booked: number
  bookings_week: number
  bookings_prev_week: number
  today_total: number
  today_done: number
  attended_90: number
  no_show_90: number
  capacity_30: number
  taken_30: number
}

type Venue = {
  day: string
  school_id: string
  school_name: string
  state: string | null
  first_start: string
  last_end: string
  slots: number
  booked: number
}

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : null)

// ------------------------------------------------------------------- Home

/** Home: big numbers first (students who made appointments, today's schedule, attendance, slots filled). */
export function HomeScreen({ school, go }: { school: CalSchool; go: (section: string, view?: string) => void }) {
  const { t, lang } = useI18n()
  const [stats, setStats] = useState<Stats | null>(null)
  const [venues, setVenues] = useState<Venue[]>([])

  useEffect(() => {
    setStats(null)
    db()
      .rpc('officer_dashboard', { p_school: school.id })
      .then(({ data }) => setStats(data as Stats))
    db()
      .rpc('officer_venues', { p_from: todayKey(), p_to: todayKey() })
      .then(({ data }) => setVenues((data as Venue[]) ?? []))
  }, [school.id])

  if (!stats) return <Loading />

  const weekChange = pct(stats.bookings_week - stats.bookings_prev_week, stats.bookings_prev_week)
  const todayPct = pct(stats.today_done, stats.today_total) ?? 0
  const attendance = pct(stats.attended_90, stats.attended_90 + stats.no_show_90)
  const filled = pct(stats.taken_30, stats.capacity_30)

  return (
    <div className="space-y-4">
      <button onClick={() => go('students')} className="card block w-full text-left">
        <div className="flex items-center gap-2 text-ink">
          <Icon name="users" className="h-6 w-6" />
          <span className="text-lg">{t('dh.students')}</span>
        </div>
        <div className="mt-5 flex items-end justify-between gap-3">
          <div>
            <p className="text-4xl font-bold">
              {stats.students_booked} <span className="text-lg font-normal text-muted">{t('dh.studentsUnit')}</span>
            </p>
            <p className="mt-1 text-sm text-muted">{t('dh.of').replace('{n}', String(stats.students_total))}</p>
          </div>
          <Icon name="right" className="h-6 w-6 text-muted" />
        </div>
        <p className="mt-3 flex items-center gap-2 rounded-xl bg-success/10 px-3 py-2 text-sm font-medium text-success">
          <Icon name="trend" className="h-4 w-4" />
          {t('dh.newWeek').replace('{n}', String(stats.bookings_week))}
          {weekChange !== null && ` (${weekChange >= 0 ? '+' : ''}${weekChange}% ${t('dh.vsLast')})`}
        </p>
      </button>

      <button onClick={() => go('calendar')} className="card flex w-full items-stretch justify-between gap-4 text-left">
        <div className="flex flex-col justify-between">
          <p className="text-lg">{t('dh.today')}</p>
          <p className="mt-4 text-5xl font-bold">{stats.today_total}</p>
          <p className="mt-1 text-lg font-semibold">{t('dh.appointments')}</p>
          <div className="mt-3 space-y-1.5 text-sm" aria-label={t('dh.venue')}>
            {venues.length === 0 ? (
              <span className="flex items-center gap-1.5 text-muted">
                <Icon name="pin" className="h-4 w-4 shrink-0" />
                {t('dh.noVenue')}
              </span>
            ) : (
              venues.map((v) => (
                <span key={v.school_id} className="flex items-start gap-1.5">
                  <Icon name="pin" className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  <span>
                    <span className="font-medium">{v.school_name}</span>
                    {v.school_id !== school.id && <span className="text-muted"> ({t('dh.otherSchool')})</span>}
                    <span className="block text-xs text-muted">
                      {formatTime(v.first_start, lang)} – {formatTime(v.last_end, lang)}
                    </span>
                  </span>
                </span>
              ))
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-xl bg-accent-soft px-2.5 py-1 text-sm font-semibold text-accent">{todayPct}%</span>
          <div
            className="relative h-28 w-3 overflow-hidden rounded-full bg-line"
            role="progressbar"
            aria-valuenow={todayPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t('dh.done')}
          >
            <div className="absolute inset-x-0 bottom-0 rounded-full bg-accent" style={{ height: `${todayPct}%` }} />
          </div>
        </div>
      </button>

      <div className="grid grid-cols-2 gap-4">
        <Meter title={t('dh.attendance')} sub={t('dh.past90')} value={attendance} />
        <Meter title={t('dh.fill')} sub={t('dh.next30')} value={filled} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <button className="btn-primary" onClick={() => go('calendar', 'slots')}>
          <Icon name="slots" className="mr-2 h-5 w-5" />
          {t('dh.addSlot')}
        </button>
        <button className="btn-ghost" onClick={() => go('calendar')}>
          <Icon name="calendar" className="mr-2 h-5 w-5" />
          {t('dh.openCalendar')}
        </button>
      </div>
    </div>
  )
}

function Meter({ title, sub, value }: { title: string; sub: string; value: number | null }) {
  const { t } = useI18n()
  return (
    <div className="card flex min-h-44 flex-col justify-between">
      <div>
        <p className="text-lg font-semibold">{title}</p>
        <p className="text-sm text-muted">{sub}</p>
      </div>
      <div>
        <p className="mb-2 text-4xl font-bold">{value === null ? <span className="text-base font-medium text-muted">{t('dh.noData')}</span> : `${value}%`}</p>
        <div className="h-2.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={value ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label={title}>
          <div className="h-full rounded-full bg-accent" style={{ width: `${value ?? 0}%` }} />
        </div>
      </div>
    </div>
  )
}

// --------------------------------------------------------------- Calendar

const statusTone = {
  booked: 'bg-amber-100 text-amber-700',
  completed: 'bg-success/15 text-success',
  no_show: 'bg-danger/10 text-danger',
} as const

/** Calendar: pick a day, see every child booked that day with the appointment type and time. */
export function DayCalendar({
  school,
  schools,
  initialDay,
  onSwitchSchool,
}: {
  school: CalSchool
  schools: CalSchool[]
  initialDay?: string
  onSwitchSchool: (schoolId: string, day: string) => void
}) {
  const { t, lang } = useI18n()
  const [day, setDay] = useState(initialDay ?? todayKey())
  // The venue whose "share with parents" panel is open.
  const [sharing, setSharing] = useState<string | null>(null)
  const start = weekStart(day)
  const [slots, setSlots] = useState<OSlot[] | null>(null)
  const [venues, setVenues] = useState<Venue[]>([])

  useEffect(() => {
    setSlots(null)
    db()
      .rpc('officer_slots', { p_school: school.id, p_from: start, p_to: addDays(start, 6) })
      .then(({ data }) => setSlots((data as OSlot[]) ?? []))
    db()
      .rpc('officer_venues', { p_from: start, p_to: addDays(start, 6) })
      .then(({ data }) => setVenues((data as Venue[]) ?? []))
  }, [school.id, start])

  const dayVenues = venues.filter((v) => v.day === day)

  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))

  const rows = useMemo(() => {
    const out: Array<Booking & { starts_at: string }> = []
    for (const s of slots ?? []) {
      if (dayKey(s.starts_at) !== day) continue
      for (const b of s.bookings) out.push({ ...b, starts_at: s.starts_at })
    }
    return out.sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.student_name.localeCompare(b.student_name))
  }, [slots, day])

  const countOn = (k: string) => (slots ?? []).filter((s) => dayKey(s.starts_at) === k).reduce((n, s) => n + s.bookings.length, 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <label className="relative inline-flex items-center gap-2 rounded-2xl bg-surface px-4 py-3 text-sm font-medium shadow-[0_4px_14px_rgba(31,52,110,0.06)]">
          <Icon name="calendar" className="h-5 w-5 text-muted" />
          {formatDate(`${day}T04:00:00Z`, lang)}
          <input
            type="date"
            aria-label={t('dc.pickDate')}
            value={day}
            onChange={(e) => e.target.value && setDay(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
        <div className="flex gap-2">
          <ArrowButton label={t('cal.prev')} onClick={() => setDay(addDays(day, -7))} icon="left" />
          <ArrowButton label={t('cal.next')} onClick={() => setDay(addDays(day, 7))} icon="right" />
        </div>
      </div>

      <div className="grid grid-cols-7 gap-2">
        {days.map((k) => {
          const selected = k === day
          const n = countOn(k)
          const { weekday, day: num } = tileLabel(k, lang)
          return (
            <button
              key={k}
              onClick={() => setDay(k)}
              aria-pressed={selected}
              aria-label={`${formatDate(`${k}T04:00:00Z`, lang)}, ${n}`}
              className={`flex flex-col items-center gap-1 rounded-2xl py-3 transition ${
                selected ? 'bg-primary text-white shadow-[0_8px_20px_rgba(47,111,237,0.35)]' : 'bg-surface text-ink'
              } ${k === todayKey() && !selected ? 'ring-2 ring-primary/40' : ''}`}
            >
              <span className={`text-xs ${selected ? 'text-white/80' : 'text-muted'}`}>{weekday}</span>
              <span className="text-lg font-semibold tabular-nums">{num}</span>
              <span className={`h-1.5 w-1.5 rounded-full ${n > 0 ? (selected ? 'bg-white' : 'bg-primary') : 'bg-transparent'}`} />
            </button>
          )
        })}
      </div>

      {dayVenues.length === 0 ? (
        <p className="flex items-center gap-2 rounded-2xl bg-surface px-4 py-3 text-sm text-muted shadow-[0_4px_14px_rgba(31,52,110,0.06)]">
          <Icon name="pin" className="h-4 w-4 shrink-0" />
          {t('dc.noVenue')}
        </p>
      ) : (
        dayVenues.map((v) => (
          <div key={v.school_id} className="flex items-start gap-3 rounded-2xl bg-surface px-4 py-3 shadow-[0_4px_14px_rgba(31,52,110,0.06)]">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
              <Icon name="pin" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted">{t('dc.venue')}</p>
              <p className="font-semibold">
                {v.school_name}
                {v.state && <span className="font-normal text-muted"> · {v.state}</span>}
              </p>
              <p className="text-sm text-muted">
                {formatTime(v.first_start, lang)} – {formatTime(v.last_end, lang)} · {t('dc.venueStats').replace('{s}', String(v.slots)).replace('{b}', String(v.booked))}
              </p>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                {v.school_id !== school.id && (
                  <button className="text-sm font-semibold text-primary" onClick={() => onSwitchSchool(v.school_id, day)}>
                    {t('dc.switch')}
                  </button>
                )}
                {schools.some((s) => s.id === v.school_id) && (
                  <button
                    className="inline-flex items-center gap-1 text-sm font-semibold text-primary"
                    aria-expanded={sharing === v.school_id}
                    onClick={() => setSharing((x) => (x === v.school_id ? null : v.school_id))}
                  >
                    <Icon name="message" className="h-4 w-4" />
                    {t('share.title')}
                  </button>
                )}
              </div>
              {sharing === v.school_id && (
                <div className="mt-3 border-t border-line pt-3">
                  <ShareWithParents bare school={schools.find((s) => s.id === v.school_id)!} day={day} />
                </div>
              )}
            </div>
          </div>
        ))
      )}

      <h2 className="text-lg font-semibold">
        {t('dc.title')} <span className="text-muted">({rows.length})</span>
      </h2>

      {slots === null ? (
        <Loading />
      ) : rows.length === 0 ? (
        <p className="card text-sm text-muted">{t('dc.none')}</p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] bg-surface shadow-[0_8px_24px_rgba(31,52,110,0.06)]">
          {rows.map((r) => (
            <li key={r.appointment_id}>
              <Link
                to={`/officer/student/${r.student_id}?school=${school.id}&appointment=${r.appointment_id}&from=calendar&day=${day}`}
                className="flex items-center gap-3 px-4 py-3 transition hover:bg-page"
              >
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-primary-soft text-lg font-bold text-primary">
                  {r.student_name.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{r.student_name}</span>
                  <span className="block truncate text-sm text-muted">
                    {lang === 'en' ? r.type_en : r.type_ms} · {r.class_name}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusTone[r.status]}`}>{t(`pat.status.${r.status}`)}</span>
                  <span className="mt-1 block text-sm text-muted">{formatTime(r.starts_at, lang)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ArrowButton({ label, onClick, icon }: { label: string; onClick: () => void; icon: 'left' | 'right' }) {
  return (
    <button onClick={onClick} aria-label={label} className="grid h-11 w-11 place-items-center rounded-2xl bg-surface shadow-[0_4px_14px_rgba(31,52,110,0.06)]">
      <Icon name={icon} className="h-5 w-5" />
    </button>
  )
}

// ------------------------------------------------------------------ Slots

type ApptType = { id: string; name_ms: string; name_en: string }

/** Kalendar: the day list of booked kids, and the calendar to add and remove slots. */
export function CalendarScreen({
  school,
  initialDay,
  view,
  onView,
  onSwitchSchool,
  schools,
}: {
  school: CalSchool
  schools: CalSchool[]
  initialDay?: string
  view: 'list' | 'slots'
  onView: (v: 'list' | 'slots') => void
  onSwitchSchool: (schoolId: string, day: string) => void
}) {
  const { t } = useI18n()
  return (
    <div className="space-y-4">
      <div className="flex gap-2" role="tablist">
        {(['list', 'slots'] as const).map((x) => (
          <button
            key={x}
            role="tab"
            aria-selected={view === x}
            onClick={() => onView(x)}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${view === x ? 'bg-primary text-white' : 'bg-surface text-ink'}`}
          >
            {t(`cal.view.${x}`)}
          </button>
        ))}
      </div>
      {view === 'list' ? <DayCalendar school={school} schools={schools} initialDay={initialDay} onSwitchSchool={onSwitchSchool} /> : <SlotCalendar school={school} schools={schools} onSwitchSchool={onSwitchSchool} />}
    </div>
  )
}

/** Add and remove appointment slots on a month calendar. */
export function SlotCalendar({
  school,
  schools,
  onSwitchSchool,
}: {
  school: CalSchool
  schools: CalSchool[]
  onSwitchSchool: (schoolId: string, day: string) => void
}) {
  const { t, lang } = useI18n()
  const [month, setMonth] = useState(todayKey().slice(0, 7))
  const [day, setDay] = useState<string | null>(null)
  const [slots, setSlots] = useState<OSlot[] | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  // Set when slots were added at a different school than the one being viewed.
  const [movedTo, setMovedTo] = useState<string | null>(null)
  // After slots are added: the school they are at, for the "share with parents" card.
  const [shareFor, setShareFor] = useState<CalSchool | null>(null)

  const all = monthDays(month, '0000-01-01')
  const days = monthDays(month, todayKey())

  const load = useCallback(async () => {
    const { data } = await db().rpc('officer_slots', { p_school: school.id, p_from: all[0], p_to: all[all.length - 1] })
    setSlots((data as OSlot[]) ?? [])
  }, [school.id, month]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setSlots(null)
    setPicked([])
    load()
  }, [load])

  const byDay = useMemo(() => {
    const map = new Map<string, OSlot[]>()
    for (const s of slots ?? []) {
      const k = dayKey(s.starts_at)
      map.set(k, [...(map.get(k) ?? []), s])
    }
    return map
  }, [slots])

  const daySlots = day ? (byDay.get(day) ?? []) : []
  const chosen = daySlots.filter((s) => picked.includes(s.id))
  const toRemove = chosen.filter((s) => s.status === 'open')
  const toReopen = chosen.filter((s) => s.status === 'blocked')
  const bookedInChosen = toRemove.reduce((n, s) => n + s.bookings.filter((b) => b.status === 'booked').length, 0)

  function toggle(id: string) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
    setMessage(null)
  }

  async function remove() {
    if (bookedInChosen > 0 && !window.confirm(t('sl.removeConfirm').replace('{n}', String(toRemove.length)).replace('{b}', String(bookedInChosen)))) return
    setBusy(true)
    setError(null)
    const { data, error } = await db().rpc('remove_slots', { p_ids: toRemove.map((s) => s.id), p_reason: reason })
    setBusy(false)
    if (error) return setError(errorCode(error))
    const r = data as { deleted: number; blocked: number; cancelled: number }
    setMessage(t('sl.removedMsg').replace('{d}', String(r.deleted)).replace('{b}', String(r.blocked)).replace('{c}', String(r.cancelled)))
    setPicked([])
    setReason('')
    load()
  }

  async function reopen() {
    setBusy(true)
    setError(null)
    for (const s of toReopen) {
      const { error } = await db().rpc('set_slot_blocked', { p_slot: s.id, p_blocked: false, p_reason: null })
      if (error) {
        setBusy(false)
        return setError(errorCode(error))
      }
    }
    setBusy(false)
    setPicked([])
    load()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold capitalize">{formatMonth(month, lang)}</h2>
        <div className="flex gap-2">
          <ArrowButton label={t('sl.prevMonth')} icon="left" onClick={() => setMonth(shiftMonth(month, -1))} />
          <ArrowButton label={t('sl.nextMonth')} icon="right" onClick={() => setMonth(shiftMonth(month, 1))} />
        </div>
      </div>

      {days.length === 0 && <p className="card text-sm text-muted">{t('book.noDay')}</p>}

      <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 md:grid-cols-7">
        {days.map((k) => {
          const selected = k === day
          const list = byDay.get(k) ?? []
          const weekend = school.weekend_days.includes(isoWeekday(k))
          const { weekday, day: num } = tileLabel(k, lang)
          return (
            <button
              key={k}
              onClick={() => {
                setDay(k)
                setPicked([])
                setMessage(null)
                setShareFor(null)
                setError(null)
              }}
              aria-pressed={selected}
              aria-label={`${formatDate(`${k}T04:00:00Z`, lang)}, ${list.length} ${t('sl.count')}`}
              className={`flex aspect-[1.1] flex-col justify-between rounded-2xl p-3 text-left transition ${
                selected
                  ? 'bg-primary text-white shadow-[0_8px_20px_rgba(47,111,237,0.35)]'
                  : weekend
                    ? 'bg-surface/50 text-muted'
                    : 'bg-surface text-ink shadow-[0_4px_14px_rgba(31,52,110,0.06)]'
              }`}
            >
              <span className="text-sm">{weekday}</span>
              <span>
                <span className="block text-3xl font-semibold tabular-nums">{num}</span>
                <span className={`block text-xs ${selected ? 'text-white/80' : 'text-muted'}`}>
                  {list.length > 0 ? `${list.length} ${t('sl.count')}` : ' '}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      {day && (
        <>
          <section className="card space-y-3">
            <h3 className="text-lg font-bold">
              {t('sl.on')} {shortDate(day, lang)} <span className="text-sm font-normal text-muted">· {school.name}</span>
            </h3>
            {slots === null && <Loading />}
            {slots && daySlots.length === 0 && <p className="text-sm text-muted">{t('sl.none')}</p>}
            {daySlots.length > 0 && <p className="text-xs text-muted">{t('sl.select')}</p>}
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
              {daySlots.map((s) => {
                const on = picked.includes(s.id)
                const blocked = s.status === 'blocked'
                return (
                  <button
                    key={s.id}
                    onClick={() => toggle(s.id)}
                    aria-pressed={on}
                    className={`rounded-2xl px-2 py-3 text-sm font-medium transition ${
                      on ? 'bg-ink text-white' : blocked ? 'bg-page text-muted line-through' : s.booked > 0 ? 'bg-primary-soft text-primary' : 'bg-page text-ink'
                    }`}
                  >
                    {formatTime(s.starts_at, lang)}
                    {(s.capacity > 1 || s.booked > 0) && !blocked && (
                      <span className="block text-xs opacity-75">
                        {s.booked}/{s.capacity}
                      </span>
                    )}
                    {blocked && <span className="block text-xs no-underline">{t('cal.statusBlocked')}</span>}
                  </button>
                )
              })}
            </div>

            {chosen.length > 0 && (
              <div className="space-y-2 border-t border-line pt-3">
                {toRemove.length > 0 && bookedInChosen > 0 && (
                  <input className="field" placeholder={t('cal.blockReason')} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
                )}
                {toRemove.length > 0 && (
                  <button className="btn-ghost text-danger" disabled={busy} onClick={remove}>
                    {t('sl.remove').replace('{n}', String(toRemove.length))}
                  </button>
                )}
                {toReopen.length > 0 && (
                  <button className="btn-ghost" disabled={busy} onClick={reopen}>
                    {t('sl.reopen').replace('{n}', String(toReopen.length))}
                  </button>
                )}
              </div>
            )}
            {message && <p className="text-sm font-medium text-success">{message}</p>}
            <ErrorText code={error} />
          </section>

          {shareFor && <ShareWithParents school={shareFor} day={day} />}

          <AddSlots
            key={day}
            school={school}
            schools={schools}
            day={day}
            onAdded={(n, venue) => {
              const elsewhere = venue.id !== school.id
              setMovedTo(n > 0 && elsewhere ? venue.id : null)
              setShareFor(n > 0 ? venue : null)
              setMessage(
                n === 0
                  ? t('sl.addedNone')
                  : elsewhere
                    ? t('sl.addedAt').replace('{n}', String(n)).replace('{s}', venue.name)
                    : t('sl.added').replace('{n}', String(n)),
              )
              load()
            }}
          />
          {message && movedTo && (
            <button className="btn-ghost" onClick={() => onSwitchSchool(movedTo, day)}>
              {t('dc.switch')}
            </button>
          )}
        </>
      )}
    </div>
  )
}

/**
 * After new slots: the parent link for that school with a ready message, to copy or send
 * (WhatsApp, or the phone's own share sheet). Parents sign in and pick a time themselves.
 */
function ShareWithParents({ school, day, bare = false }: { school: CalSchool; day: string; bare?: boolean }) {
  const { t, lang } = useI18n()
  const [copied, setCopied] = useState<'message' | 'link' | null>(null)
  const link = `${location.origin}${import.meta.env.BASE_URL}#/s/${school.slug}`
  const message = t('share.message')
    .replace('{s}', school.name)
    .replace('{d}', formatDate(`${day}T04:00:00Z`, lang))
    .replace('{l}', link)

  async function copy(what: 'message' | 'link') {
    try {
      await navigator.clipboard.writeText(what === 'message' ? message : link)
      setCopied(what)
    } catch {
      window.prompt(t('share.copyManual'), what === 'message' ? message : link)
    }
  }

  // `bare`: inside another card (the Lokasi card), which already shows the title.
  return (
    <section className={bare ? 'space-y-3' : 'card space-y-3'}>
      {!bare && (
        <h3 className="flex items-center gap-2 text-lg font-bold">
          <Icon name="message" className="h-5 w-5 text-primary" />
          {t('share.title')}
        </h3>
      )}
      <p className="text-sm text-muted">{t('share.body')}</p>
      <p className="whitespace-pre-line break-words rounded-2xl bg-page p-3 text-sm text-ink">{message}</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <button type="button" className="btn-primary" onClick={() => copy('message')}>
          {copied === 'message' ? t('share.copied') : t('share.copy')}
        </button>
        <a className="btn-ghost text-center" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">
          {t('share.whatsapp')}
        </a>
        {typeof navigator.share === 'function' && (
          <button type="button" className="btn-ghost" onClick={() => navigator.share({ title: 'Vaksin App', text: message }).catch(() => {})}>
            {t('share.more')}
          </button>
        )}
      </div>
      <button type="button" className="text-sm font-semibold text-primary" onClick={() => copy('link')}>
        {copied === 'link' ? t('share.copied') : t('share.copyLink')}
      </button>
    </section>
  )
}

function AddSlots({
  school,
  schools,
  day,
  onAdded,
}: {
  school: CalSchool
  schools: CalSchool[]
  day: string
  onAdded: (n: number, venue: CalSchool) => void
}) {
  const { t, lang } = useI18n()
  const [types, setTypes] = useState<ApptType[]>([])
  const [start, setStart] = useState('08:00')
  const [end, setEnd] = useState('11:00')
  const [minutes, setMinutes] = useState(15)
  const [capacity, setCapacity] = useState(1)
  const [typeId, setTypeId] = useState('')
  const [venueId, setVenueId] = useState(school.id)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    db()
      .from('appointment_types')
      .select('id, name_ms, name_en')
      .eq('active', true)
      .order('sort_order')
      .then(({ data }) => setTypes((data as ApptType[]) ?? []))
  }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (end <= start) return setError('bad_time')
    setBusy(true)
    const { data, error } = await db().rpc('add_slots', {
      p_school: venueId,
      p_date: day,
      p_start: start,
      p_end: end,
      p_minutes: minutes,
      p_capacity: capacity,
      p_type: typeId || null,
    })
    setBusy(false)
    if (error) return setError(errorCode(error))
    onAdded(data as number, schools.find((x) => x.id === venueId) ?? school)
  }

  return (
    <form onSubmit={submit} className="card grid gap-3 sm:grid-cols-2">
      <h3 className="text-lg font-bold sm:col-span-2">{t('sl.addTitle')}</h3>
      <label className="block sm:col-span-2">
        <span className="label">{t('sl.venue')}</span>
        <select className="field" value={venueId} onChange={(e) => setVenueId(e.target.value)}>
          {schools.map((sc) => (
            <option key={sc.id} value={sc.id}>
              {sc.name}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs text-muted">{t('sl.venueHint')}</span>
      </label>
      <label className="block">
        <span className="label">{t('cal.start')}</span>
        <input className="field" type="time" required value={start} onChange={(e) => setStart(e.target.value)} />
      </label>
      <label className="block">
        <span className="label">{t('cal.end')}</span>
        <input className="field" type="time" required value={end} onChange={(e) => setEnd(e.target.value)} />
      </label>
      <label className="block">
        <span className="label">{t('cal.slotMinutes')}</span>
        <select className="field" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
          {[10, 15, 20, 30, 45, 60].map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="label">{t('cal.capacity')}</span>
        <input className="field" type="number" min={1} max={100} required value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} />
      </label>
      <label className="block sm:col-span-2">
        <span className="label">{t('sl.type')}</span>
        <select className="field" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
          <option value="">{t('cal.anyType')}</option>
          {types.map((ty) => (
            <option key={ty.id} value={ty.id}>
              {lang === 'en' ? ty.name_en : ty.name_ms}
            </option>
          ))}
        </select>
      </label>
      <div className="sm:col-span-2">
        <ErrorText code={error} />
        <button className="btn-primary mt-2" disabled={busy}>
          <Icon name="slots" className="mr-2 h-5 w-5" />
          {t('sl.add')}
        </button>
      </div>
    </form>
  )
}
