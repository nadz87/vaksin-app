import { useState, type ReactNode } from 'react'
import { useI18n } from '../lib/i18n'
import { ErrorText } from './Layout'
import { Icon } from './icons'

/**
 * A trash button (or, with children, a red text button), then "remove X?" with the consequence
 * spelled out, then the result. onRemove returns an error code, or null when it worked.
 */
export function RemoveButton({
  label,
  confirmText,
  onRemove,
  children,
}: {
  label: string
  confirmText: string
  onRemove: () => Promise<string | null>
  children?: ReactNode
}) {
  const { t } = useI18n()
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!asking) {
    return children ? (
      <button type="button" className="btn-ghost inline-flex items-center justify-center gap-2 text-danger" onClick={() => setAsking(true)}>
        <Icon name="trash" className="h-5 w-5" />
        {children}
      </button>
    ) : (
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
