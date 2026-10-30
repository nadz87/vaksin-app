import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { db, errorCode } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useI18n } from '../lib/i18n'
import { displayMyPhone, normalizeMyPhone } from '../lib/phone'
import type { Place } from '../lib/places'
import { ErrorText, Loading } from '../components/Layout'
import { Icon } from '../components/icons'
import { TypeIcon } from '../components/TypeIcon'
import { ExportTab } from './officer-students'

export const SETTINGS_VIEWS = ['account', 'types', 'export'] as const
export type SettingsView = (typeof SETTINGS_VIEWS)[number]

/** Tetapan: own account and the clinic locations, the appointment types, and the Excel export. */
export function SettingsScreen({
  locations,
  onLocationsChanged,
  view,
  onView,
}: {
  locations: Place[]
  onLocationsChanged: () => Promise<Place[]>
  view: SettingsView
  onView: (v: SettingsView) => void
}) {
  const { t } = useI18n()

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="tablist">
        {SETTINGS_VIEWS.map((x) => (
          <button
            key={x}
            role="tab"
            aria-selected={view === x}
            onClick={() => onView(x)}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition ${view === x ? 'bg-primary text-white' : 'bg-surface text-ink'}`}
          >
            {t(`set.${x}`)}
          </button>
        ))}
      </div>

      {view === 'account' && (
        <>
          <Account />
          <Locations locations={locations} onChanged={onLocationsChanged} />
        </>
      )}
      {view === 'types' && <TypesTab />}
      {view === 'export' && <ExportTab />}
    </div>
  )
}

/** The officer's own profile: name, job title and phone. The email is the sign-in, so it stays. */
function Account() {
  const { t } = useI18n()
  const { profile, session, refresh } = useAuth()
  const [fullName, setFullName] = useState(profile?.full_name ?? '')
  const [jobTitle, setJobTitle] = useState(profile?.job_title ?? '')
  const [phone, setPhone] = useState(profile?.phone ? displayMyPhone(profile.phone) : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function save(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSaved(false)
    const normalized = phone.trim() ? normalizeMyPhone(phone) : null
    if (phone.trim() && !normalized) return setError('invalid_phone')
    setBusy(true)
    const { error } = await db()
      .from('profiles')
      .update({ full_name: fullName.trim(), job_title: jobTitle.trim(), phone: normalized })
      .eq('user_id', profile!.user_id)
    setBusy(false)
    if (error) return setError('generic')
    await refresh()
    setSaved(true)
  }

  return (
    <form onSubmit={save} className="card space-y-3">
      <h2 className="text-lg font-bold">{t('set.accountTitle')}</h2>
      <label className="block">
        <span className="label">{t('profile.fullName')}</span>
        <input className="field" required minLength={2} maxLength={120} value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </label>
      <label className="block">
        <span className="label">{t('profile.jobTitle')}</span>
        <input className="field" required minLength={2} maxLength={120} value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
      </label>
      <label className="block">
        <span className="label">{t('profile.phone')}</span>
        <input className="field" type="tel" inputMode="tel" placeholder={t('profile.phoneHint')} value={phone} onChange={(e) => setPhone(e.target.value)} />
      </label>
      <div className="flex justify-between gap-4 text-sm">
        <span className="text-muted">{t('signin.email')}</span>
        <span className="break-all text-right font-medium">{session?.user.email ?? '—'}</span>
      </div>
      <ErrorText code={error} />
      {saved && <p className="text-sm font-medium text-success">{t('set.saved')}</p>}
      <button className="btn-primary" disabled={busy || fullName.trim().length < 2 || jobTitle.trim().length < 2}>
        {t('set.saveAccount')}
      </button>
    </form>
  )
}

type Removal = { cancelled: number; removed: number }

/** What a removal did, for the line shown after it. */
function removedText(t: (k: string) => string, name: string, r: Removal) {
  return (r.cancelled > 0 ? t('rm.doneCancelled') : t('rm.done')).replace('{s}', name).replace('{n}', String(r.cancelled))
}

/** A row's trash button, then "remove X?" with the consequence spelled out, then the result. */
function RemoveButton({ label, confirmText, onRemove }: { label: string; confirmText: string; onRemove: () => Promise<string | null> }) {
  const { t } = useI18n()
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!asking) {
    return (
      <button type="button" aria-label={label} title={label} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-danger hover:bg-danger/10" onClick={() => setAsking(true)}>
        <Icon name="trash" className="h-5 w-5" />
      </button>
    )
  }
  return (
    <div className="basis-full space-y-2 rounded-2xl bg-danger/5 p-3">
      <p className="text-sm">{confirmText}</p>
      <ErrorText code={error} />
      <div className="flex gap-2">
        <button
          type="button"
          className="rounded-xl bg-danger px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            setError(null)
            const code = await onRemove()
            setBusy(false)
            if (code) setError(code)
            else setAsking(false)
          }}
        >
          {t('rm.yes')}
        </button>
        <button type="button" className="rounded-xl px-4 py-2 text-sm font-semibold text-ink" disabled={busy} onClick={() => setAsking(false)}>
          {t('rm.no')}
        </button>
      </div>
    </div>
  )
}

/** Every location with its parent link; any officer can add one or remove an added one. */
function Locations({ locations, onChanged }: { locations: Place[]; onChanged: () => Promise<Place[]> }) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const base = `${location.origin}${import.meta.env.BASE_URL}#/s/`

  async function add(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setMessage(null)
    const { error } = await db().rpc('add_location', { p_name: name.trim(), p_address: address.trim() || null })
    setBusy(false)
    if (error) return setError(errorCode(error))
    setName('')
    setAddress('')
    await onChanged()
  }

  async function remove(l: Place) {
    const { data, error } = await db().rpc('remove_location', { p_location: l.id })
    if (error) return errorCode(error)
    setMessage(removedText(t, l.name, data as Removal))
    await onChanged()
    return null
  }

  return (
    <section className="card space-y-3">
      <h2 className="text-lg font-bold">{t('loc.title')}</h2>
      <p className="text-sm text-muted">{t('loc.body')}</p>
      {message && <p className="text-sm font-medium text-success">{message}</p>}
      <ul className="divide-y divide-line">
        {locations.map((l) => (
          <li key={l.id} className="flex flex-wrap items-start gap-2 py-2">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{l.name}</p>
              {l.address && <p className="text-sm text-muted">{l.address}</p>}
              <a className="break-all text-sm text-primary" href={base + l.slug}>
                {base + l.slug}
              </a>
            </div>
            {/* The default clinic stays: its link is the one parents already have. */}
            {l.slug !== 'kkp18' && (
              <RemoveButton label={t('loc.remove')} confirmText={t('loc.removeConfirm').replace('{s}', l.name)} onRemove={() => remove(l)} />
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="space-y-3 border-t border-line pt-3">
        <h3 className="font-semibold">{t('loc.addTitle')}</h3>
        <label className="block">
          <span className="label">{t('loc.name')}</span>
          <input className="field" required minLength={3} maxLength={120} placeholder={t('loc.namePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">{t('loc.address')}</span>
          <input className="field" maxLength={200} value={address} onChange={(e) => setAddress(e.target.value)} />
        </label>
        <ErrorText code={error} />
        <button className="btn-ghost" disabled={busy || name.trim().length < 3}>
          {t('loc.save')}
        </button>
      </form>
    </section>
  )
}

type TypeRow = { id: string; name_ms: string; name_en: string; icon: string; color: string }

/** Jenis temujanji: the list parents choose from. Shared by every officer. */
function TypesTab() {
  const { t, lang } = useI18n()
  const [types, setTypes] = useState<TypeRow[] | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data } = await db().from('appointment_types').select('id, name_ms, name_en, icon, color').eq('active', true).order('sort_order')
    setTypes((data as TypeRow[]) ?? [])
  }, [])
  useEffect(() => {
    load()
  }, [load])

  async function add(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setMessage(null)
    const { error } = await db().rpc('add_appointment_type', { p_name: name.trim() })
    setBusy(false)
    if (error) return setError(errorCode(error))
    setName('')
    await load()
  }

  async function remove(x: TypeRow) {
    const { data, error } = await db().rpc('remove_appointment_type', { p_type: x.id })
    if (error) return errorCode(error)
    setMessage(removedText(t, x.name_ms, data as Removal))
    await load()
    return null
  }

  if (!types) return <Loading />

  return (
    <div className="space-y-4">
      <section className="card space-y-3">
        <h2 className="text-lg font-bold">{t('type.title')}</h2>
        <p className="text-sm text-muted">{t('type.body')}</p>
        {message && <p className="text-sm font-medium text-success">{message}</p>}
        <ul className="divide-y divide-line">
          {types.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center gap-3 py-2">
              <TypeIcon name={x.icon} color={x.color} />
              <p className="min-w-0 flex-1 font-medium">{lang === 'en' ? x.name_en : x.name_ms}</p>
              <RemoveButton label={t('type.remove')} confirmText={t('type.removeConfirm').replace('{s}', x.name_ms)} onRemove={() => remove(x)} />
            </li>
          ))}
        </ul>
      </section>

      <form onSubmit={add} className="card space-y-3">
        <h3 className="font-semibold">{t('type.addTitle')}</h3>
        <label className="block">
          <span className="label">{t('type.name')}</span>
          <input className="field" required minLength={3} maxLength={60} placeholder={t('type.namePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <p className="text-xs text-muted">{t('type.parentsSee')}</p>
        <ErrorText code={error} />
        <button className="btn-primary" disabled={busy || name.trim().length < 3}>
          {t('type.save')}
        </button>
      </form>
    </div>
  )
}
