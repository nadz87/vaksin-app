import { useState, type FormEvent } from 'react'
import { db, errorCode } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useI18n } from '../lib/i18n'
import { ErrorText } from '../components/Layout'
import { ClosuresTab, ScheduleTab, type Place } from './officer-calendar'
import { ExportTab } from './officer-students'

export const SETTINGS_VIEWS = ['account', 'schedule', 'closures', 'export'] as const
export type SettingsView = (typeof SETTINGS_VIEWS)[number]

/** Tetapan: account and locations, the weekly schedule, days off and the Excel export. */
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
      {view === 'schedule' && <ScheduleTab locations={locations} />}
      {view === 'closures' && <ClosuresTab />}
      {view === 'export' && <ExportTab />}
    </div>
  )
}

function Account() {
  const { t } = useI18n()
  const { profile, session } = useAuth()
  const rows: Array<[string, string]> = [
    [t('profile.fullName'), profile?.full_name ?? '—'],
    [t('profile.jobTitle'), profile?.job_title ?? '—'],
    [t('signin.email'), session?.user.email ?? '—'],
  ]
  return (
    <section className="card space-y-2">
      <h2 className="text-lg font-bold">{t('set.accountTitle')}</h2>
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4 text-sm">
          <span className="text-muted">{label}</span>
          <span className="break-all text-right font-medium">{value}</span>
        </div>
      ))}
    </section>
  )
}

/** Every location with its parent link, and a form to add one (any officer can). */
function Locations({ locations, onChanged }: { locations: Place[]; onChanged: () => Promise<Place[]> }) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const base = `${location.origin}${import.meta.env.BASE_URL}#/s/`

  async function add(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await db().rpc('add_location', { p_name: name.trim(), p_address: address.trim() || null })
    setBusy(false)
    if (error) return setError(errorCode(error))
    setName('')
    setAddress('')
    await onChanged()
  }

  return (
    <section className="card space-y-3">
      <h2 className="text-lg font-bold">{t('loc.title')}</h2>
      <p className="text-sm text-muted">{t('loc.body')}</p>
      <ul className="divide-y divide-line">
        {locations.map((l) => (
          <li key={l.id} className="py-2">
            <p className="font-medium">{l.name}</p>
            {l.address && <p className="text-sm text-muted">{l.address}</p>}
            <a className="break-all text-sm text-primary" href={base + l.slug}>
              {base + l.slug}
            </a>
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
