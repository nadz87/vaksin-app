import { useEffect, useState, type ReactNode } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { useI18n } from '../lib/i18n'
import { useAuth } from '../lib/auth'

export function Shell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const { t, lang, setLang } = useI18n()
  const { session, signOut } = useAuth()
  const online = useOnline()
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  return (
    <div className={`mx-auto min-h-dvh px-4 pb-10 pt-4 ${wide ? 'max-w-5xl' : 'max-w-md'}`}>
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" className="h-9 w-9" />
          <span className="text-lg font-bold">{t('app.name')}</span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <button className="font-medium text-primary" onClick={() => setLang(lang === 'ms' ? 'en' : 'ms')}>
            {t('lang.toggle')}
          </button>
          {session && (
            <button className="text-muted" onClick={signOut}>
              {t('signout')}
            </button>
          )}
        </div>
      </header>

      {!online && <div className="error mb-4">{t('common.offline')}</div>}
      {needRefresh && (
        <button className="btn-primary mb-4" onClick={() => updateServiceWorker(true)}>
          {t('common.update')}
        </button>
      )}

      {children}
    </div>
  )
}

export function Centered({ children }: { children: ReactNode }) {
  return <div className="card space-y-4">{children}</div>
}

export function Loading() {
  const { t } = useI18n()
  return <p className="py-10 text-center text-muted">{t('common.loading')}</p>
}

export function ErrorText({ code }: { code: string | null }) {
  const { t } = useI18n()
  if (!code) return null
  return <p className="error" role="alert">{t(`err.${code}`)}</p>
}

function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}
