import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { db, errorCode } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useI18n } from '../lib/i18n'
import { displayMyPhone } from '../lib/phone'
import { dayKey, formatDate, formatMonth, formatTime, icsFile, monthDays, shiftMonth, tileLabel, todayKey } from '../lib/time'
import { TypeIcon } from '../components/TypeIcon'
import { ErrorText, Loading } from '../components/Layout'

type Child = { id: string; full_name: string; school_id: string; schools: { name: string } | null }
type ApptType = { id: string; code: string; name_ms: string; name_en: string; icon: string; color: string; needs_reason: boolean }
type Slot = { id: string; starts_at: string; ends_at: string; appointment_type_id: string | null; capacity: number; remaining: number }
type Step = 'what' | 'when' | 'confirm' | 'done'

/** P5-P8: who + what, then date tiles + time chips, then confirm, then success. */
export function BookFlow() {
  const { t, lang } = useI18n()
  const { profile } = useAuth()
  const [params] = useSearchParams()

  const [children, setChildren] = useState<Child[] | null>(null)
  const [types, setTypes] = useState<ApptType[]>([])
  const [childId, setChildId] = useState<string | null>(params.get('child'))
  const [slots, setSlots] = useState<Slot[] | null>(null)
  const [typeId, setTypeId] = useState<string | null>(null)
  const [month, setMonth] = useState(todayKey().slice(0, 7))
  const [day, setDay] = useState<string | null>(null)
  const [slotId, setSlotId] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [step, setStep] = useState<Step>('what')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      db().from('students').select('id, full_name, school_id, schools(name)').order('full_name'),
      db().from('appointment_types').select('id, code, name_ms, name_en, icon, color, needs_reason').eq('active', true).order('sort_order'),
    ]).then(([c, ty]) => {
      const kids = (c.data as unknown as Child[]) ?? []
      setChildren(kids)
      setTypes((ty.data as ApptType[]) ?? [])
      setChildId((id) => (id && kids.some((k) => k.id === id) ? id : (kids[0]?.id ?? null)))
    })
  }, [])

  const child = children?.find((c) => c.id === childId) ?? null

  const loadSlots = useCallback(async () => {
    if (!child) return
    setSlots(null)
    const { data } = await db().rpc('available_slots', { p_school: child.school_id })
    setSlots((data as Slot[]) ?? [])
  }, [child])

  useEffect(() => {
    loadSlots()
  }, [loadSlots])

  // Slots usable for the chosen type: slots for that type, or open to any type.
  const typeSlots = useMemo(
    () => (slots ?? []).filter((s) => typeId && (s.appointment_type_id === null || s.appointment_type_id === typeId)),
    [slots, typeId],
  )
  const slotsByDay = useMemo(() => {
    const map = new Map<string, Slot[]>()
    for (const s of typeSlots) {
      const k = dayKey(s.starts_at)
      map.set(k, [...(map.get(k) ?? []), s])
    }
    return map
  }, [typeSlots])

  const type = types.find((x) => x.id === typeId) ?? null
  const slot = typeSlots.find((s) => s.id === slotId) ?? null
  const typeName = (x: ApptType) => (lang === 'en' ? x.name_en : x.name_ms)

  function pickType(id: string) {
    setTypeId(id)
    setDay(null)
    setSlotId(null)
    // Jump to the first month that has a slot for this type.
    const first = (slots ?? []).find((s) => s.appointment_type_id === null || s.appointment_type_id === id)
    if (first) setMonth(dayKey(first.starts_at).slice(0, 7))
    setStep('when')
  }

  async function confirm() {
    if (!slot || !child || !type) return
    setBusy(true)
    setError(null)
    const { error } = await db().rpc('book_slot', { p_slot: slot.id, p_student: child.id, p_type: type.id, p_note: note })
    setBusy(false)
    if (!error) return setStep('done')
    const code = errorCode(error)
    setError(code)
    if (code === 'slot_full' || code === 'slot_unavailable') {
      setSlotId(null)
      await loadSlots()
      setStep('when')
    }
  }

  function addToCalendar() {
    if (!slot || !child || !type) return
    const blob = icsFile({
      title: `${typeName(type)}: ${child.full_name}`,
      start: slot.starts_at,
      end: slot.ends_at,
      location: child.schools?.name ?? '',
      uid: slot.id + child.id,
    })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'temujanji-vaksin-app.ics'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  if (!children) return <Loading />
  if (children.length === 0) {
    return (
      <div className="card space-y-4">
        <p className="text-muted">{t('home.noChildren')}</p>
        <Link to="/" className="btn-primary">{t('common.back')}</Link>
      </div>
    )
  }

  // P5: child + occasion ----------------------------------------------------
  if (step === 'what') {
    return (
      <div className="space-y-5">
        <Header title={t('book.title')} back="/" />
        {children.length > 1 && (
          <section className="space-y-2">
            <h3 className="label">{t('book.whichChild')}</h3>
            <div className="flex flex-wrap gap-2">
              {children.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setChildId(c.id)}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${c.id === childId ? 'bg-primary text-white' : 'bg-surface text-ink'}`}
                >
                  {c.full_name}
                </button>
              ))}
            </div>
          </section>
        )}
        {child && (
          <p className="text-sm text-muted">
            {child.full_name} · {child.schools?.name}
          </p>
        )}
        <section className="space-y-2">
          <h3 className="label">{t('book.whatFor')}</h3>
          {slots === null ? (
            <Loading />
          ) : (
            <>
              {slots.length === 0 && <p className="card text-sm text-muted">{t('book.noSlotsSchool')}</p>}
              <div className="grid grid-cols-2 gap-3">
              {types.map((x) => {
                const has = slots.some((s) => s.appointment_type_id === null || s.appointment_type_id === x.id)
                return (
                  <button
                    key={x.id}
                    disabled={!has}
                    onClick={() => pickType(x.id)}
                    className="card flex flex-col items-start gap-3 p-4 text-left transition hover:ring-2 hover:ring-primary/30 disabled:opacity-50"
                  >
                    <TypeIcon name={x.icon} color={x.color} />
                    <span>
                      <span className="block font-semibold leading-tight">{typeName(x)}</span>
                      {!has && slots.length > 0 && <span className="mt-1 block text-xs text-muted">{t('book.noSlotsType')}</span>}
                    </span>
                  </button>
                )
              })}
              </div>
            </>
          )}
        </section>
      </div>
    )
  }

  // P6: date tiles + time chips ---------------------------------------------
  if (step === 'when' && type) {
    const days = monthDays(month, todayKey())
    const daySlots = day ? (slotsByDay.get(day) ?? []) : []
    const anyThisMonth = days.some((d) => slotsByDay.has(d))
    return (
      <div className="space-y-4 pb-24">
        <Header title={typeName(type)} onBack={() => setStep('what')} />
        <ErrorText code={error} />
        <div className="flex items-center justify-between">
          <h3 className="text-2xl font-bold capitalize">{formatMonth(month, lang)}</h3>
          <div className="flex gap-2">
            <MonthButton label="<" disabled={month <= todayKey().slice(0, 7)} onClick={() => setMonth(shiftMonth(month, -1))} />
            <MonthButton label=">" onClick={() => setMonth(shiftMonth(month, 1))} />
          </div>
        </div>

        {!anyThisMonth && <p className="card text-sm text-muted">{t('book.noDay')}</p>}

        <div className="grid grid-cols-3 gap-3">
          {days.map((d) => {
            const has = slotsByDay.has(d)
            const selected = d === day
            const { weekday, day: num } = tileLabel(d, lang)
            return (
              <button
                key={d}
                disabled={!has}
                onClick={() => {
                  setDay(d)
                  setSlotId(null)
                  setError(null)
                  // Time chips sit below the month grid: bring them into view.
                  requestAnimationFrame(() => document.getElementById('time-chips')?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
                }}
                aria-label={formatDate(`${d}T04:00:00Z`, lang)}
                aria-pressed={selected}
                className={`flex aspect-[1.05] flex-col justify-between rounded-2xl p-3 text-left transition ${
                  selected
                    ? 'bg-primary text-white shadow-[0_8px_20px_rgba(47,111,237,0.35)]'
                    : has
                      ? 'bg-surface text-ink shadow-[0_4px_14px_rgba(31,52,110,0.06)]'
                      : 'bg-surface/50 text-muted/60'
                }`}
              >
                <span className="text-sm">{weekday}</span>
                <span className="text-3xl font-semibold tabular-nums">{num}</span>
              </button>
            )
          })}
        </div>

        {day && (
          <section id="time-chips" className="scroll-mb-28 space-y-2">
            <h3 className="label">{t('book.time')}</h3>
            <div className="grid grid-cols-3 gap-2">
              {daySlots.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSlotId(s.id)}
                  aria-pressed={s.id === slotId}
                  className={`rounded-2xl px-2 py-3 text-sm font-medium transition ${
                    s.id === slotId ? 'bg-primary text-white' : 'bg-surface text-ink'
                  }`}
                >
                  {formatTime(s.starts_at, lang)}
                  {s.capacity > 1 && (
                    <span className="block text-xs opacity-75">
                      {s.remaining} {t('book.placesLeft')}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </section>
        )}

        <StickyAction label={t('book.next')} disabled={!slot} onClick={() => setStep('confirm')} />
      </div>
    )
  }

  // P7: confirm ---------------------------------------------------------------
  if (step === 'confirm' && type && slot && child) {
    const noteOk = !type.needs_reason || note.trim().length > 0
    return (
      <div className="space-y-4 pb-24">
        <Header title={t('book.confirmTitle')} onBack={() => setStep('when')} />
        <div className="card space-y-3">
          <div className="flex items-center gap-3">
            <TypeIcon name={type.icon} color={type.color} />
            <p className="font-semibold">{typeName(type)}</p>
          </div>
          <Row label={t('book.child')} value={child.full_name} />
          <Row label={t('child.school')} value={child.schools?.name ?? ''} />
          <Row label={t('book.date')} value={formatDate(slot.starts_at, lang)} />
          <Row label={t('book.at')} value={formatTime(slot.starts_at, lang)} />
          {profile?.phone && <Row label={t('book.contact')} value={`${profile.full_name} · ${displayMyPhone(profile.phone)}`} />}
        </div>
        <label className="block">
          <span className="label">{type.needs_reason ? t('book.noteRequired') : t('book.note')}</span>
          <textarea className="field min-h-24" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </label>
        <ErrorText code={error} />
        <StickyAction label={t('book.confirm')} disabled={busy || !noteOk} onClick={confirm} />
      </div>
    )
  }

  // P8: success -------------------------------------------------------------
  if (step === 'done' && type && slot && child) {
    return (
      <div className="card space-y-5 text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-success/15 text-success">
          <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <div>
          <h2 className="text-xl font-bold">{t('book.doneTitle')}</h2>
          <p className="mt-1 text-muted">
            {typeName(type)} · {child.full_name}
          </p>
          <p className="font-semibold">
            {formatDate(slot.starts_at, lang)}, {formatTime(slot.starts_at, lang)}
          </p>
        </div>
        <p className="text-sm text-muted">{t('book.doneBody')}</p>
        <button className="btn-ghost" onClick={addToCalendar}>{t('book.addCalendar')}</button>
        <Link to="/" className="btn-primary">{t('book.viewMine')}</Link>
      </div>
    )
  }

  return <Loading />
}

function Header({ title, back, onBack }: { title: string; back?: string; onBack?: () => void }) {
  const { t } = useI18n()
  const cls = 'grid h-11 w-11 place-items-center rounded-2xl bg-surface shadow-[0_4px_14px_rgba(31,52,110,0.06)]'
  const arrow = (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  )
  return (
    <div className="flex items-center gap-3">
      {back ? (
        <Link to={back} className={cls} aria-label={t('common.back')}>{arrow}</Link>
      ) : (
        <button onClick={onBack} className={cls} aria-label={t('common.back')}>{arrow}</button>
      )}
      <h2 className="text-xl font-bold">{title}</h2>
    </div>
  )
}

function MonthButton({ label, disabled, onClick }: { label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={disabled} className="grid h-9 w-9 place-items-center rounded-xl bg-surface font-semibold disabled:opacity-30">
      {label}
    </button>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-muted">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  )
}

function StickyAction({ label, disabled, onClick }: { label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <div className="fixed inset-x-0 bottom-0 bg-gradient-to-t from-page via-page/95 to-transparent px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-6">
      <div className="mx-auto max-w-md">
        <button className="btn-primary" disabled={disabled} onClick={onClick}>
          {label}
        </button>
      </div>
    </div>
  )
}
