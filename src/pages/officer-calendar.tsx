import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { db, errorCode } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useI18n } from '../lib/i18n'
import { addDays, isoWeekday, shortDate, todayKey, weekdayName } from '../lib/time'
import { ErrorText, Loading } from '../components/Layout'

/** A clinic location where slots are held (Klinik Kesihatan Putrajaya P18 by default). */
export type Place = { id: string; name: string; slug: string; weekend_days: number[]; address: string | null }

type Rule = {
  id: string
  weekday: number
  start_time: string
  end_time: string
  slot_minutes: number
  capacity: number
  appointment_type_ids: string[]
  location_id: string
}
type ApptType = { id: string; name_ms: string; name_en: string }
type Closure = { id: string; date: string; reason: string | null }

// ----------------------------------------------------------- Weekly schedule

export function ScheduleTab({ locations }: { locations: Place[] }) {
  const { t, lang } = useI18n()
  const { profile } = useAuth()
  const [rules, setRules] = useState<Rule[] | null>(null)
  const [types, setTypes] = useState<ApptType[]>([])
  const [weekday, setWeekday] = useState(1)
  const [startTime, setStartTime] = useState('08:00')
  const [endTime, setEndTime] = useState('11:00')
  const [minutes, setMinutes] = useState(15)
  const [capacity, setCapacity] = useState(1)
  const [typeIds, setTypeIds] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [placeId, setPlaceId] = useState(() => (locations.find((l) => l.slug === 'kkp18') ?? locations[0])?.id ?? '')
  const place = locations.find((l) => l.id === placeId)

  const workDays = [1, 2, 3, 4, 5, 6, 7].filter((d) => !(place?.weekend_days ?? [6, 7]).includes(d))

  const load = useCallback(async () => {
    const [r, ty] = await Promise.all([
      db()
        .from('availability_rules')
        .select('id, weekday, start_time, end_time, slot_minutes, capacity, appointment_type_ids, location_id')
        .order('weekday')
        .order('start_time'),
      db().from('appointment_types').select('id, name_ms, name_en').eq('active', true).order('sort_order'),
    ])
    setRules((r.data as Rule[]) ?? [])
    setTypes((ty.data as ApptType[]) ?? [])
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!workDays.includes(weekday)) setWeekday(workDays[0] ?? 1)
  }, [placeId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function addRule(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setMessage(null)
    if (endTime <= startTime) return setError('bad_time')
    const { error } = await db().from('availability_rules').insert({
      officer_id: profile!.user_id,
      location_id: placeId,
      weekday,
      start_time: startTime,
      end_time: endTime,
      slot_minutes: minutes,
      capacity,
      appointment_type_ids: typeIds,
    })
    if (error) return setError(errorCode(error))
    load()
  }

  async function deleteRule(id: string) {
    await db().from('availability_rules').delete().eq('id', id)
    load()
  }

  async function generate() {
    setBusy(true)
    setError(null)
    setMessage(null)
    const { data, error } = await db().rpc('generate_my_slots', { p_weeks: 8 })
    setBusy(false)
    if (error) return setError(errorCode(error))
    setMessage(`${data as number} ${t('cal.generated')}`)
  }

  const typeName = (id: string) => {
    const x = types.find((y) => y.id === id)
    return x ? (lang === 'en' ? x.name_en : x.name_ms) : ''
  }

  return (
    <div className="space-y-4">
      <section className="card space-y-3">
        <h2 className="text-lg font-bold">{t('cal.rules')}</h2>
        {rules === null && <Loading />}
        {rules?.length === 0 && <p className="text-sm text-muted">{t('cal.noRules')}</p>}
        <ul className="space-y-2">
          {rules?.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 rounded-xl bg-page p-3 text-sm">
              <span>
                <strong>{weekdayName(r.weekday, lang)}</strong> {r.start_time.slice(0, 5)}–{r.end_time.slice(0, 5)} · {r.slot_minutes} min ·{' '}
                {r.capacity}×
                <span className="block text-muted">{locations.find((l) => l.id === r.location_id)?.name}</span>
                <span className="block text-muted">
                  {r.appointment_type_ids.length === 0 ? t('cal.anyType') : r.appointment_type_ids.map(typeName).join(', ')}
                </span>
              </span>
              <button className="shrink-0 text-danger" onClick={() => deleteRule(r.id)}>
                {t('cal.deleteRule')}
              </button>
            </li>
          ))}
        </ul>
        <button className="btn-primary" disabled={busy || !rules?.length} onClick={generate}>
          {t('cal.generate')}
        </button>
        <p className="text-xs text-muted">{t('cal.generateHint')}</p>
        {message && <p className="text-sm font-medium text-success">{message}</p>}
      </section>

      <form onSubmit={addRule} className="card grid gap-3 sm:grid-cols-2">
        <h2 className="text-lg font-bold sm:col-span-2">{t('cal.addRule')}</h2>
        <label className="block sm:col-span-2">
          <span className="label">{t('sl.venue')}</span>
          <select className="field" value={placeId} onChange={(e) => setPlaceId(e.target.value)}>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">{t('cal.weekday')}</span>
          <select className="field" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
            {workDays.map((d) => (
              <option key={d} value={d}>
                {weekdayName(d, lang)}
              </option>
            ))}
          </select>
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
          <span className="label">{t('cal.start')}</span>
          <input className="field" type="time" required value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">{t('cal.end')}</span>
          <input className="field" type="time" required value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">{t('cal.capacity')}</span>
          <input className="field" type="number" min={1} max={100} required value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} />
        </label>
        <fieldset className="sm:col-span-2">
          <legend className="label">{t('cal.types')}</legend>
          <div className="flex flex-wrap gap-2">
            {types.map((ty) => {
              const on = typeIds.includes(ty.id)
              return (
                <button
                  type="button"
                  key={ty.id}
                  aria-pressed={on}
                  onClick={() => setTypeIds(on ? typeIds.filter((x) => x !== ty.id) : [...typeIds, ty.id])}
                  className={`rounded-full px-4 py-2 text-sm font-medium ${on ? 'bg-primary text-white' : 'bg-page text-ink'}`}
                >
                  {lang === 'en' ? ty.name_en : ty.name_ms}
                </button>
              )
            })}
          </div>
        </fieldset>
        <div className="sm:col-span-2">
          <ErrorText code={error} />
          <button className="btn-primary mt-2 sm:w-auto">{t('cal.saveRule')}</button>
        </div>
      </form>
    </div>
  )
}

// ------------------------------------------------------------------ Closures

/** Days off: the officer's open slots on that day are blocked and any bookings cancelled. */
export function ClosuresTab() {
  const { t, lang } = useI18n()
  const [closures, setClosures] = useState<Closure[] | null>(null)
  const [date, setDate] = useState(addDays(todayKey(), 1))
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data } = await db()
      .from('closures')
      .select('id, date, reason')
      .gte('date', todayKey())
      .order('date')
    setClosures((data as Closure[]) ?? [])
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function add(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setMessage(null)
    const { data, error } = await db().rpc('add_closure', { p_date: date, p_reason: reason })
    if (error) return setError(errorCode(error))
    setMessage(t('cal.closureAdded').replace('{n}', String(data as number)))
    setReason('')
    load()
  }

  async function remove(id: string) {
    if (!window.confirm(t('cal.removeConfirm'))) return
    setError(null)
    setMessage(null)
    const { error } = await db().rpc('remove_closure', { p_closure: id })
    if (error) return setError(errorCode(error))
    load()
  }

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="card grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label">{t('cal.closureDate')}</span>
          <input className="field" type="date" required min={todayKey()} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">{t('cal.closureReason')}</span>
          <input className="field" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={120} />
        </label>
        <div className="sm:col-span-2">
          <ErrorText code={error} />
          {message && <p className="mb-2 text-sm font-medium text-success">{message}</p>}
          <button className="btn-primary sm:w-auto">{t('cal.addClosure')}</button>
        </div>
      </form>

      <section className="space-y-2">
        {closures === null && <Loading />}
        {closures?.length === 0 && <p className="card text-sm text-muted">{t('cal.noClosures')}</p>}
        {closures?.map((c) => (
          <div key={c.id} className="card flex items-center justify-between gap-3">
            <div>
              <p className="font-semibold">
                {weekdayName(isoWeekday(c.date), lang)}, {shortDate(c.date, lang)}
              </p>
              {c.reason && <p className="text-sm text-muted">{c.reason}</p>}
            </div>
            <button className="shrink-0 text-sm font-medium text-primary" onClick={() => remove(c.id)}>
              {t('cal.removeClosure')}
            </button>
          </div>
        ))}
      </section>
    </div>
  )
}
