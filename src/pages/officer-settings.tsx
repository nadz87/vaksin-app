import { useEffect, useState, type FormEvent } from 'react'
import { db, errorCode } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useI18n } from '../lib/i18n'
import { ErrorText } from '../components/Layout'
import { ClosuresTab, ScheduleTab, type CalSchool } from './officer-calendar'
import { ExportTab } from './officer-students'

/**
 * The officer chooses the schools they serve (no admin assignment). `first`: shown on the
 * home screen while they have none yet. Leaving is refused while a child has an upcoming
 * appointment there (the database says school_has_bookings).
 */
export function MySchools({ mine, onChange, first = false }: { mine: CalSchool[]; onChange: () => void; first?: boolean }) {
  const { t } = useI18n()
  const [all, setAll] = useState<Array<{ id: string; name: string }> | null>(null)
  const [pick, setPick] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    db()
      .rpc('list_schools')
      .then(({ data }) => setAll((data as Array<{ id: string; name: string }>) ?? []))
  }, [])

  const mineIds = new Set(mine.map((s) => s.id))

  async function join(e: FormEvent) {
    e.preventDefault()
    if (!pick) return
    setBusy(true)
    setError(null)
    const { error } = await db().rpc('officer_join_school', { p_school: pick })
    setBusy(false)
    if (error) return setError(errorCode(error))
    setPick('')
    onChange()
  }

  async function leave(school: CalSchool) {
    if (!window.confirm(t('my.leaveConfirm').replace('{s}', school.name))) return
    setError(null)
    const { error } = await db().rpc('officer_leave_school', { p_school: school.id })
    if (error) return setError(errorCode(error))
    onChange()
  }

  return (
    <section className="card space-y-3">
      <h2 className="text-lg font-bold">{t(first ? 'my.firstTitle' : 'my.title')}</h2>
      <p className="text-sm text-muted">{t(first ? 'my.firstBody' : 'my.body')}</p>
      {mine.length > 0 && (
        <ul className="divide-y divide-line">
          {mine.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 py-2">
              <span className="font-medium">{s.name}</span>
              <button type="button" className="shrink-0 text-sm font-semibold text-danger" onClick={() => leave(s)}>
                {t('my.leave')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={join} className="flex flex-col gap-2 sm:flex-row">
        <select className="field" aria-label={t('my.pick')} value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">{all ? t('my.pick') : t('common.loading')}</option>
          {(all ?? [])
            .filter((s) => !mineIds.has(s.id))
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </select>
        <button className="btn-primary sm:w-auto" disabled={!pick || busy}>
          {t('my.add')}
        </button>
      </form>
      <ErrorText code={error} />
    </section>
  )
}

export const SETTINGS_VIEWS = ['school', 'schedule', 'closures', 'export'] as const
export type SettingsView = (typeof SETTINGS_VIEWS)[number]

/** Tetapan: choose the school being managed, the weekly schedule, closed days and the Excel export. */
export function SettingsScreen({
  schools,
  school,
  view,
  onView,
  onPickSchool,
  onSchoolsChanged,
}: {
  schools: CalSchool[]
  school: CalSchool
  view: SettingsView
  onView: (v: SettingsView) => void
  onPickSchool: (id: string) => void
  onSchoolsChanged: () => void
}) {
  const { t } = useI18n()
  const { profile, session } = useAuth()

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

      {view === 'school' && (
        <>
          <section className="card space-y-3">
            <h2 className="text-lg font-bold">{t('set.school')}</h2>
            <p className="text-sm text-muted">{t('set.pickSchool')}</p>
            <select className="field" aria-label={t('set.school')} value={school.id} onChange={(e) => onPickSchool(e.target.value)}>
              {schools.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </section>
          <MySchools mine={schools} onChange={onSchoolsChanged} />
          <section className="card space-y-2">
            <h2 className="text-lg font-bold">{t('set.account')}</h2>
            <div className="flex justify-between gap-4 text-sm">
              <span className="text-muted">{t('profile.fullName')}</span>
              <span className="text-right font-medium">{profile?.full_name ?? '—'}</span>
            </div>
            <div className="flex justify-between gap-4 text-sm">
              <span className="text-muted">{t('profile.jobTitle')}</span>
              <span className="text-right font-medium">{profile?.job_title ?? '—'}</span>
            </div>
            <div className="flex justify-between gap-4 text-sm">
              <span className="text-muted">{t('signin.email')}</span>
              <span className="break-all text-right font-medium">{session?.user.email}</span>
            </div>
          </section>
        </>
      )}
      {view === 'schedule' && <ScheduleTab school={school} />}
      {view === 'closures' && <ClosuresTab school={school} />}
      {view === 'export' && <ExportTab school={school} />}
    </div>
  )
}
