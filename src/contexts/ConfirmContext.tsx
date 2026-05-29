'use client'

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

interface ConfirmOptions {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'default' | 'danger'
}

interface ConfirmContextType {
  confirm: (options: ConfirmOptions | string) => Promise<boolean>
}

const ConfirmContext = createContext<ConfirmContextType | undefined>(undefined)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [opts, setOpts] = useState<ConfirmOptions>({ message: '' })
  const [resolver, setResolver] = useState<((v: boolean) => void) | null>(null)

  const confirm = useCallback((options: ConfirmOptions | string) => {
    const normalized: ConfirmOptions = typeof options === 'string'
      ? { message: options }
      : options
    setOpts(normalized)
    setOpen(true)
    return new Promise<boolean>(resolve => {
      setResolver(() => resolve)
    })
  }, [])

  const close = (result: boolean) => {
    setOpen(false)
    if (resolver) resolver(result)
    setResolver(null)
  }

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {open && (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          onKeyDown={e => {
            if (e.key === 'Escape') close(false)
            if (e.key === 'Enter') close(true)
          }}
        >
          <div
            className="absolute inset-0 bg-black/50 animate-fade-in"
            onClick={() => close(false)}
          />
          <div
            className="relative bg-surface-elevated rounded-xl shadow-2xl border border-border-default w-full max-w-md animate-fade-in-up"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-5 border-b border-border-default">
              <h2 className="text-base font-bold text-foreground">
                {opts.title || (opts.variant === 'danger' ? 'Are you sure?' : 'Confirm')}
              </h2>
            </div>
            <div className="p-5">
              <p className="text-sm text-foreground-secondary whitespace-pre-line">{opts.message}</p>
            </div>
            <div className="px-5 py-3 border-t border-border-default flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => close(false)}
                autoFocus
                className="px-3 py-1.5 text-sm font-medium text-foreground-secondary hover:text-foreground transition-colors"
              >
                {opts.cancelLabel || 'Cancel'}
              </button>
              <button
                type="button"
                onClick={() => close(true)}
                className={`px-4 py-1.5 rounded-lg text-sm font-semibold text-white transition-all active:scale-95 ${
                  opts.variant === 'danger'
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-accent-500 hover:bg-accent-600'
                }`}
              >
                {opts.confirmLabel || (opts.variant === 'danger' ? 'Delete' : 'Confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within a ConfirmProvider')
  return ctx.confirm
}
