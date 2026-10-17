'use client'

import { useEffect } from 'react'
import { Settings, X } from 'lucide-react'
import { useCanWrite } from '@/contexts/AdminScopesContext'

export type ConnectionState = 'connected' | 'pending' | 'none'

const DOT: Record<ConnectionState, string> = {
  connected: 'bg-green-500',
  pending: 'bg-amber-500',
  none: 'bg-gray-400',
}
const STATE_TEXT: Record<ConnectionState, string> = {
  connected: 'Connected',
  pending: 'Choose an account to finish connecting',
  none: 'Not connected',
}

/** Header gear for an integration page: a status dot, and a dialog holding the page's connection panel.
 * Same look and placement as AdminIntegrationsPopup; the flagship and stores use it identically. */
export default function ConnectionsGear({
  title,
  scope,
  state,
  open,
  onOpenChange,
  children,
}: {
  title: string
  /** Write area that may change the connection, e.g. 'amazon_ads'. */
  scope: string
  state: ConnectionState
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}) {
  const canWrite = useCanWrite(scope)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onOpenChange(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  return (
    <>
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        title={`${title}: ${STATE_TEXT[state]}`}
        aria-label={`${title} (${STATE_TEXT[state]})`}
        className="relative inline-flex items-center justify-center w-9 h-control-sm rounded-lg border border-border-default text-foreground-secondary hover:bg-surface-secondary transition-colors"
      >
        <Settings className="w-4 h-4" />
        <span
          className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full ring-2 ring-surface ${DOT[state]}`}
          aria-hidden
        />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
          onClick={() => onOpenChange(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="w-full max-w-2xl rounded-2xl border border-border-default bg-surface-elevated shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border-default px-6 py-4">
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${DOT[state]}`} aria-hidden />
                <h2 className="text-base font-bold text-foreground">{title}</h2>
                <span className="text-xs text-foreground-muted">{STATE_TEXT[state]}</span>
              </div>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                aria-label="Close"
                className="p-1 rounded-lg text-foreground-muted hover:bg-surface-secondary"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4 p-6">
              {!canWrite && (
                <p className="text-xs text-foreground-muted">
                  View only. An admin with write access to this integration can change the connection.
                </p>
              )}
              {children}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/** Body shown on an integration page while it is not connected; the button opens the same gear dialog. */
export function NotConnectedState({ provider, onOpen }: { provider: string; onOpen: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-border-default bg-surface-elevated px-6 py-10 text-center space-y-3">
      <p className="text-sm text-foreground-secondary">
        Not connected. Use the gear (top right) to connect your {provider} account.
      </p>
      <button
        type="button"
        onClick={onOpen}
        className="inline-flex items-center gap-1.5 px-3 h-control-sm rounded-lg border border-border-default text-foreground-secondary hover:bg-surface-secondary text-sm font-medium transition-colors"
      >
        <Settings className="w-4 h-4" /> Connect
      </button>
    </div>
  )
}
