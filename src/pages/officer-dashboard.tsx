import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { db, errorCode } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { addDays, dayKey, formatDate, formatMonth, formatTime, isoWeekday, monthDays, shiftMonth, shortDate, tileLabel, todayKey, weekStart } from '../lib/time'
import { Icon } from '../components/icons'
import { RemoveButton } from '../components/RemoveButton'
import { ErrorText, Loading } from '../components/Layout'
import type { Place } from '../lib/places'

type Booking = {
  appointment_id: string
  status: 'booked' | 'completed' | 'no_show'
  student_id: string
  student_no: string
  student_name: string
  class_name: string
  school_name: string
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
  location_id: string
  location_name: string
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
  location_id: string
  location_name: string
  location_slug: string
  address: string | null
  first_start: string
  last_end: string
  slots: number
  booked: number
}

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : null)

// ------------------------------------------------------------------- Home

/** Home: big numbers first (students who made appointments, today's schedule, attendance, slots filled). */
export function HomeScreen({ go }: { go: (section: string, view?: string) => void }) {
  const { t, lang } = useI18n()
  const [stats, setStats] = useState<Stats | null>(null)
  const [venues, setVenues] = useState<Venue[]>([])

  useEffect(() => {
    setStats(null)
    db()
      .rpc('officer_dashboard')
      .then(({ data }) => setStats(data as Stats))
    db()
      .rpc('officer_venues', { p_from: todayKey(), p_to: todayKey() })
      .then(({ data }) => setVenues((data as Venue[]) ?? []))
  }, [])

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
                <span key={v.location_id} className="flex items-start gap-1.5">
                  <Icon name="pin" className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  <span>
                    <span className="font-medium">{v.location_name}</span>
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
export function DayCalendar({ initialDay }: { initialDay?: string }) {
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
      .rpc('officer_slots', { p_from: start, p_to: addDays(start, 6) })
      .then(({ data }) => setSlots((data as OSlot[]) ?? []))
    db()
      .rpc('officer_venues', { p_from: start, p_to: addDays(start, 6) })
      .then(({ data }) => setVenues((data as Venue[]) ?? []))
  }, [start])

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
          <div key={v.location_id} className="flex items-start gap-3 rounded-2xl bg-surface px-4 py-3 shadow-[0_4px_14px_rgba(31,52,110,0.06)]">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
              <Icon name="pin" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted">{t('dc.venue')}</p>
              <p className="font-semibold">
                {v.location_name}
                {v.address && <span className="font-normal text-muted"> · {v.address}</span>}
              </p>
              <p className="text-sm text-muted">
                {formatTime(v.first_start, lang)} – {formatTime(v.last_end, lang)} · {t('dc.venueStats').replace('{s}', String(v.slots)).replace('{b}', String(v.booked))}
              </p>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                <button
                  className="inline-flex items-center gap-1 text-sm font-semibold text-primary"
                  aria-expanded={sharing === v.location_id}
                  onClick={() => setSharing((x) => (x === v.location_id ? null : v.location_id))}
                >
                  <Icon name="message" className="h-4 w-4" />
                  {t('share.title')}
                </button>
              </div>
              {sharing === v.location_id && (
                <div className="mt-3 border-t border-line pt-3">
                  <ShareWithParents bare place={{ name: v.location_name, slug: v.location_slug }} day={day} />
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
                to={`/officer/student/${r.student_id}?appointment=${r.appointment_id}&from=calendar&day=${day}`}
                className="flex items-center gap-3 px-4 py-3 transition hover:bg-page"
              >
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-primary-soft text-lg font-bold text-primary">
                  {r.student_name.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{r.student_name}</span>
                  <span className="block truncate text-sm text-muted">
                    {lang === 'en' ? r.type_en : r.type_ms} · {r.class_name} · {r.school_name}
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
  locations,
  onLocationsChanged,
  initialDay,
  view,
  onView,
}: {
  locations: Place[]
  onLocationsChanged: () => Promise<Place[]>
  initialDay?: string
  view: 'list' | 'slots'
  onView: (v: 'list' | 'slots') => void
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
      {view === 'list' ? <DayCalendar initialDay={initialDay} /> : <SlotCalendar locations={locations} onLocationsChanged={onLocationsChanged} />}
    </div>
  )
}

/** Add and remove appointment slots on a month calendar. */
export function SlotCalendar({
  locations,
  onLocationsChanged,
}: {
  locations: Place[]
  onLocationsChanged: () => Promise<Place[]>
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
  // After slots are added: the location they are at, for the "share with parents" card.
  const [shareFor, setShareFor] = useState<Place | null>(null)

  const all = monthDays(month, '0000-01-01')
  const days = monthDays(month, todayKey())

  const load = useCallback(async () => {
    const { data } = await db().rpc('officer_slots', { p_from: all[0], p_to: all[all.length - 1] })
    setSlots((data as OSlot[]) ?? [])
  }, [month]) // eslint-disable-line react-hooks/exhaustive-deps

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
  // Show the location under each time only when the day has slots at more than one place.
  const manyPlaces = new Set(daySlots.map((s) => s.location_id)).size > 1
  const chosen = daySlots.filter((s) => picked.includes(s.id))
  const toRemove = chosen.filter((s) => s.status === 'open')
  const toReopen = chosen.filter((s) => s.status === 'blocked')
  const bookedInChosen = toRemove.reduce((n, s) => n + s.bookings.filter((b) => b.status === 'booked').length, 0)
  // The date's trash button: every open slot on the day.
  const dayOpen = daySlots.filter((s) => s.status === 'open')
  const dayBooked = dayOpen.reduce((n, s) => n + s.bookings.filter((b) => b.status === 'booked').length, 0)

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

  async function removeDay() {
    const { data, error } = await db().rpc('remove_slots', { p_ids: dayOpen.map((s) => s.id), p_reason: null })
    if (error) return errorCode(error)
    const r = data as { deleted: number; blocked: number; cancelled: number }
    setMessage(t('sl.removedMsg').replace('{d}', String(r.deleted)).replace('{b}', String(r.blocked)).replace('{c}', String(r.cancelled)))
    setPicked([])
    await load()
    return null
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
          const weekend = isoWeekday(k) >= 6
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
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="min-w-0 flex-1 text-lg font-bold">
                {t('sl.on')} {shortDate(day, lang)}
              </h3>
              {dayOpen.length > 0 && (
                <RemoveButton
                  label={t('sl.removeDay')}
                  confirmText={(dayBooked > 0 ? t('sl.removeConfirm') : t('sl.removeConfirmEmpty'))
                    .replace('{n}', String(dayOpen.length))
                    .replace('{b}', String(dayBooked))}
                  onRemove={removeDay}
                />
              )}
            </div>
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
                    {manyPlaces && <span className="block truncate text-xs opacity-75">{s.location_name}</span>}
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
                  <button className="btn-ghost inline-flex items-center justify-center gap-2 text-danger" disabled={busy} onClick={remove}>
                    <Icon name="trash" className="h-5 w-5" />
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

          {shareFor && <ShareWithParents place={shareFor} day={day} />}

          <AddSlots
            key={day}
            locations={locations}
            onLocationsChanged={onLocationsChanged}
            day={day}
            onAdded={(n, place) => {
              setShareFor(n > 0 ? place : null)
              setMessage(n === 0 ? t('sl.addedNone') : t('sl.addedAt').replace('{n}', String(n)).replace('{s}', place.name))
              load()
            }}
          />
        </>
      )}
    </div>
  )
}

/**
 * After new slots: the parent link for that location with a ready message, to copy or send
 * (WhatsApp, or the phone's own share sheet). Parents sign in and pick a time themselves.
 */
function ShareWithParents({ place, day, bare = false }: { place: { name: string; slug: string }; day: string; bare?: boolean }) {
  const { t, lang } = useI18n()
  const [copied, setCopied] = useState<'message' | 'link' | null>(null)
  const link = `${location.origin}${import.meta.env.BASE_URL}#/s/${place.slug}`
  const message = t('share.message')
    .replace('{s}', place.name)
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

const NEW_PLACE = '__new'
const NEW_TYPE = '__newtype'

/**
 * Tambah slot: the appointment type first (every slot has one; "+ Cipta jenis temujanji" adds
 * a type that parents then see), then the location (Klinik Kesihatan Putrajaya P18 by default;
 * "+ Tambah lokasi baharu" adds one on the spot).
 */
function AddSlots({
  locations,
  onLocationsChanged,
  day,
  onAdded,
}: {
  locations: Place[]
  onLocationsChanged: () => Promise<Place[]>
  day: string
  onAdded: (n: number, place: Place) => void
}) {
  const { t, lang } = useI18n()
  const [types, setTypes] = useState<ApptType[]>([])
  const [typeId, setTypeId] = useState('')
  const [placeId, setPlaceId] = useState(() => (locations.find((l) => l.slug === 'kkp18') ?? locations[0])?.id ?? '')
  const [newName, setNewName] = useState('')
  const [newAddress, setNewAddress] = useState('')
  const [newType, setNewType] = useState('')
  const [start, setStart] = useState('08:00')
  const [end, setEnd] = useState('11:00')
  const [minutes, setMinutes] = useState(15)
  const [capacity, setCapacity] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadTypes = useCallback(async () => {
    const { data } = await db().from('appointment_types').select('id, name_ms, name_en').eq('active', true).order('sort_order')
    const list = (data as ApptType[]) ?? []
    setTypes(list)
    setTypeId((id) => (id && list.some((x) => x.id === id) ? id : (list[0]?.id ?? '')))
    return list
  }, [])
  useEffect(() => {
    loadTypes()
  }, [loadTypes])

  async function addType() {
    setBusy(true)
    setError(null)
    const { data, error } = await db().rpc('add_appointment_type', { p_name: newType.trim() })
    if (error) {
      setBusy(false)
      return setError(errorCode(error))
    }
    await loadTypes()
    setTypeId((data as { id: string }).id)
    setNewType('')
    setBusy(false)
  }

  async function addPlace() {
    setBusy(true)
    setError(null)
    const { data, error } = await db().rpc('add_location', { p_name: newName.trim(), p_address: newAddress.trim() || null })
    if (error) {
      setBusy(false)
      return setError(errorCode(error))
    }
    await onLocationsChanged()
    setPlaceId((data as { id: string }).id)
    setNewName('')
    setNewAddress('')
    setBusy(false)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (placeId === NEW_PLACE) return setError('bad_location')
    if (!typeId || typeId === NEW_TYPE) return setError('bad_type')
    if (end <= start) return setError('bad_time')
    setBusy(true)
    const { data, error } = await db().rpc('add_slots', {
      p_location: placeId,
      p_type: typeId,
      p_date: day,
      p_start: start,
      p_end: end,
      p_minutes: minutes,
      p_capacity: capacity,
    })
    setBusy(false)
    if (error) return setError(errorCode(error))
    const place = locations.find((l) => l.id === placeId)
    if (place) onAdded(data as number, place)
  }

  return (
    <form onSubmit={submit} className="card grid gap-3 sm:grid-cols-2">
      <h3 className="text-lg font-bold sm:col-span-2">{t('sl.addTitle')}</h3>
      <label className="block sm:col-span-2">
        <span className="label">{t('sl.type')}</span>
        <select className="field" required value={typeId} onChange={(e) => setTypeId(e.target.value)}>
          {types.map((ty) => (
            <option key={ty.id} value={ty.id}>
              {lang === 'en' ? ty.name_en : ty.name_ms}
            </option>
          ))}
          <option value={NEW_TYPE}>{t('type.addOption')}</option>
        </select>
      </label>
      {typeId === NEW_TYPE && (
        <div className="space-y-3 rounded-2xl bg-page p-3 sm:col-span-2">
          <label className="block">
            <span className="label">{t('type.name')}</span>
            <input className="field" required minLength={3} maxLength={60} placeholder={t('type.namePlaceholder')} value={newType} onChange={(e) => setNewType(e.target.value)} />
          </label>
          <p className="text-xs text-muted">{t('type.parentsSee')}</p>
          <button type="button" className="btn-ghost" disabled={busy || newType.trim().length < 3} onClick={addType}>
            {t('type.save')}
          </button>
        </div>
      )}
      <label className="block sm:col-span-2">
        <span className="label">{t('sl.venue')}</span>
        <select className="field" value={placeId} onChange={(e) => setPlaceId(e.target.value)}>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
          <option value={NEW_PLACE}>{t('loc.addOption')}</option>
        </select>
        <span className="mt-1 block text-xs text-muted">{t('sl.venueHint')}</span>
      </label>
      {placeId === NEW_PLACE && (
        <div className="space-y-3 rounded-2xl bg-page p-3 sm:col-span-2">
          <label className="block">
            <span className="label">{t('loc.name')}</span>
            <input className="field" required minLength={3} maxLength={120} placeholder={t('loc.namePlaceholder')} value={newName} onChange={(e) => setNewName(e.target.value)} />
          </label>
          <label className="block">
            <span className="label">{t('loc.address')}</span>
            <input className="field" maxLength={200} value={newAddress} onChange={(e) => setNewAddress(e.target.value)} />
          </label>
          <button type="button" className="btn-ghost" disabled={busy || newName.trim().length < 3} onClick={addPlace}>
            {t('loc.save')}
          </button>
        </div>
      )}
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
      <div className="sm:col-span-2">
        <ErrorText code={error} />
        <button className="btn-primary mt-2" disabled={busy || placeId === NEW_PLACE || !typeId || typeId === NEW_TYPE}>
          <Icon name="slots" className="mr-2 h-5 w-5" />
          {t('sl.add')}
        </button>
      </div>
    </form>
  )
}
