import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router'
import { db } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { displayMyPhone, normalizeMyPhone } from '../lib/phone'
import { formatDate } from '../lib/time'
import { ErrorText, Loading } from '../components/Layout'

type Kid = {
  id: string
  student_no: string
  full_name: string
  class_name: string
  mykid_last4: string
  date_of_birth: string
  gender: 'male' | 'female'
  blood_group: string | null
  height_cm: number | null
  weight_kg: number | null
  allergies: string | null
  conditions: string | null
  medications: string | null
  emergency_contact_name: string | null
  emergency_contact_phone: string | null
  schools: { name: string } | null
}

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']

// Everything the parent can edit, as the text the inputs hold.
type Form = {
  fullName: string
  className: string
  blood: string
  height: string
  weight: string
  allergies: string
  conditions: string
  medications: string
  emName: string
  emPhone: string
}

function toForm(k: Kid): Form {
  return {
    fullName: k.full_name,
    className: k.class_name,
    blood: k.blood_group ?? '',
    height: k.height_cm == null ? '' : String(k.height_cm),
    weight: k.weight_kg == null ? '' : String(k.weight_kg),
    allergies: k.allergies ?? '',
    conditions: k.conditions ?? '',
    medications: k.medications ?? '',
    emName: k.emergency_contact_name ?? '',
    emPhone: k.emergency_contact_phone ? displayMyPhone(k.emergency_contact_phone) : '',
  }
}

/** Form text -> database values, or an error code for the first problem found. */
function toPayload(f: Form): { code: string | null; data: Record<string, unknown> } {
  const num = (text: string) => (text.trim() === '' ? null : Number(text.trim().replace(',', '.')))
  const height = num(f.height)
  const weight = num(f.weight)
  if (height !== null && !(height >= 30 && height <= 250)) return { code: 'invalid_height', data: {} }
  if (weight !== null && !(weight >= 2 && weight <= 250)) return { code: 'invalid_weight', data: {} }

  let phone: string | null = null
  if (f.emPhone.trim() !== '') {
    phone = normalizeMyPhone(f.emPhone)
    if (!phone) return { code: 'invalid_phone', data: {} }
  }

  const text = (v: string) => v.trim() || null
  return {
    code: null,
    data: {
      full_name: f.fullName.trim(),
      class_name: f.className.trim(),
      blood_group: f.blood || null,
      height_cm: height,
      weight_kg: weight,
      allergies: text(f.allergies),
      conditions: text(f.conditions),
      medications: text(f.medications),
      emergency_contact_name: text(f.emName),
      emergency_contact_phone: phone,
    },
  }
}

/** A parent edits their child's details. School, MyKid, child ID, birth date and gender stay locked. */
export function ChildEdit() {
  const { t, lang } = useI18n()
  const { id = '' } = useParams()
  const [kid, setKid] = useState<Kid | null | undefined>(undefined)
  const [form, setForm] = useState<Form | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    const { data } = await db()
      .from('students')
      .select(
        'id, student_no, full_name, class_name, mykid_last4, date_of_birth, gender, blood_group, height_cm, weight_kg, allergies, conditions, medications, emergency_contact_name, emergency_contact_phone, schools(name)',
      )
      .eq('id', id)
      .maybeSingle()
    const row = (data as unknown as Kid | null) ?? null
    setKid(row)
    if (row) setForm(toForm(row))
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  if (kid === undefined) return <Loading />

  const header = (
    <div className="flex items-center gap-3">
      <Link
        to="/profile"
        aria-label={t('common.back')}
        className="grid h-11 w-11 place-items-center rounded-2xl bg-surface shadow-[0_4px_14px_rgba(31,52,110,0.06)]"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
      </Link>
      <h2 className="text-xl font-bold">{t('child.title')}</h2>
    </div>
  )

  if (kid === null || !form) {
    return (
      <div className="space-y-4">
        {header}
        <p className="card text-sm text-muted">{t('kid.notFound')}</p>
      </div>
    )
  }

  const changed = JSON.stringify(form) !== JSON.stringify(toForm(kid))

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f))
    setSaved(false)
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!form) return
    setSaved(false)
    const { code, data } = toPayload(form)
    if (code) return setError(code)
    setBusy(true)
    setError(null)
    const { data: updated, error } = await db().from('students').update(data).eq('id', id).select('id')
    setBusy(false)
    if (error || !updated || updated.length === 0) return setError('generic')
    await load()
    setSaved(true)
  }

  return (
    <div className="space-y-5">
      {header}

      <section className="card space-y-2">
        <div>
          <p className="text-xs text-muted">{t('child.studentNo')}</p>
          <p className="text-lg font-bold tracking-wide">{kid.student_no}</p>
        </div>
        <Row label={t('child.school')} value={kid.schools?.name ?? ''} />
        <Row label={t('child.mykid')} value={`******-**-${kid.mykid_last4}`} />
        <Row label={t('child.dob')} value={formatDate(`${kid.date_of_birth}T04:00:00Z`, lang)} />
        <Row label={t('child.gender')} value={kid.gender === 'male' ? t('child.male') : t('child.female')} />
        <p className="pt-1 text-xs text-muted">{t('kid.locked')}</p>
      </section>

      <form onSubmit={save} className="card space-y-4">
        <label className="block">
          <span className="label">{t('child.fullName')}</span>
          <input className="field" required minLength={2} maxLength={120} value={form.fullName} onChange={(e) => set('fullName', e.target.value)} />
        </label>
        <label className="block">
          <span className="label">{t('child.class')}</span>
          <input className="field" required maxLength={40} value={form.className} onChange={(e) => set('className', e.target.value)} />
        </label>

        <fieldset className="space-y-4 border-t border-line pt-4">
          <legend className="text-base font-bold">{t('kid.health')}</legend>
          <p className="-mt-1 text-xs text-muted">{t('kid.hint')}</p>
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="label">{t('kid.blood')}</span>
              <select className="field px-3" value={form.blood} onChange={(e) => set('blood', e.target.value)}>
                <option value="" />
                {BLOOD_GROUPS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="label">{t('kid.height')}</span>
              <input className="field px-3" inputMode="decimal" maxLength={5} value={form.height} onChange={(e) => set('height', e.target.value)} />
            </label>
            <label className="block">
              <span className="label">{t('kid.weight')}</span>
              <input className="field px-3" inputMode="decimal" maxLength={5} value={form.weight} onChange={(e) => set('weight', e.target.value)} />
            </label>
          </div>
          <label className="block">
            <span className="label">{t('kid.allergies')}</span>
            <textarea className="field min-h-20" maxLength={500} placeholder={t('kid.noneHint')} value={form.allergies} onChange={(e) => set('allergies', e.target.value)} />
          </label>
          <label className="block">
            <span className="label">{t('kid.conditions')}</span>
            <textarea className="field min-h-20" maxLength={500} placeholder={t('kid.noneHint')} value={form.conditions} onChange={(e) => set('conditions', e.target.value)} />
          </label>
          <label className="block">
            <span className="label">{t('kid.medications')}</span>
            <textarea className="field min-h-20" maxLength={500} placeholder={t('kid.noneHint')} value={form.medications} onChange={(e) => set('medications', e.target.value)} />
          </label>
        </fieldset>

        <fieldset className="space-y-4 border-t border-line pt-4">
          <legend className="text-base font-bold">{t('kid.emergency')}</legend>
          <label className="block">
            <span className="label">{t('kid.emName')}</span>
            <input className="field" autoComplete="off" maxLength={120} value={form.emName} onChange={(e) => set('emName', e.target.value)} />
          </label>
          <label className="block">
            <span className="label">{t('kid.emPhone')}</span>
            <input
              className="field"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              placeholder={t('profile.phoneHint')}
              value={form.emPhone}
              onChange={(e) => set('emPhone', e.target.value)}
            />
          </label>
        </fieldset>

        <ErrorText code={error} />
        {saved && <p className="text-sm font-medium text-success">{t('kid.saved')}</p>}
        <button className="btn-primary" disabled={busy || !changed || form.fullName.trim().length < 2 || !form.className.trim()}>
          {t('me.save')}
        </button>
      </form>
    </div>
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
