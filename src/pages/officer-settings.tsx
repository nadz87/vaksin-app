import { useAuth } from '../lib/auth'
import { useI18n } from '../lib/i18n'
import { ClosuresTab, ScheduleTab, type CalSchool } from './officer-calendar'
import { ExportTab } from './officer-students'

export const SETTINGS_VIEWS = ['school', 'schedule', 'closures', 'export'] as const
export type SettingsView = (typeof SETTINGS_VIEWS)[number]

/** Tetapan: choose the school being managed, the weekly schedule, closed days and the Excel export. */
export function SettingsScreen({
  schools,
  school,
  view,
  onView,
  onPickSchool,
}: {
  schools: CalSchool[]
  school: CalSchool
  view: SettingsView
  onView: (v: SettingsView) => void
  onPickSchool: (id: string) => void
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
          <section className="card space-y-2">
            <h2 className="text-lg font-bold">{t('set.account')}</h2>
            <div className="flex justify-between gap-4 text-sm">
              <span className="text-muted">{t('profile.fullName')}</span>
              <span className="text-right font-medium">{profile?.full_name ?? '—'}</span>
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
