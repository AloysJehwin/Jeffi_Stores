'use client'

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

interface ConfirmOptions {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'default' | 'danger'
}

interface PromptOptions extends Omit<ConfirmOptions, 'variant'> {
  placeholder?: string
  defaultValue?: string
}

interface ConfirmContextType {
  confirm: (options: ConfirmOptions | string) => Promise<boolean>
  prompt: (options: PromptOptions | string) => Promise<string | null>
}

const ConfirmContext = createContext<ConfirmContextType | undefined>(undefined)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [opts, setOpts] = useState<ConfirmOptions & { input?: PromptOptions }>({ message: '' })
  const [resolver, setResolver] = useState<((v: boolean) => void) | null>(null)
  const [inputValue, setInputValue] = useState('')
  const inputRef = useRef('')

  const confirm = useCallback((options: ConfirmOptions | string) => {
    const normalized: ConfirmOptions = typeof options === 'string' ? { message: options } : options
    setOpts(normalized)
    setOpen(true)
    return new Promise<boolean>(resolve => {
      setResolver(() => resolve)
    })
  }, [])

  const prompt = useCallback((options: PromptOptions | string) => {
    const o: PromptOptions = typeof options === 'string' ? { message: options } : options
    inputRef.current = o.defaultValue ?? ''
    setInputValue(inputRef.current)
    setOpts({ ...o, input: o })
    setOpen(true)
    return new Promise<string | null>(resolve => {
      setResolver(() => (ok: boolean) => resolve(ok ? inputRef.current.trim() || null : null))
    })
  }, [])

  const close = (result: boolean) => {
    setOpen(false)
    if (resolver) resolver(result)
    setResolver(null)
  }

  return (
    <ConfirmContext.Provider value={{ confirm, prompt }}>
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
          <div className="absolute inset-0 bg-black/50 animate-fade-in" onClick={() => close(false)} />
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
              {opts.input && (
                <input
                  autoFocus
                  value={inputValue}
                  placeholder={opts.input.placeholder}
                  onChange={e => { inputRef.current = e.target.value; setInputValue(e.target.value) }}
                  className="mt-3 w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm"
                />
              )}
            </div>
            <div className="px-5 py-3 border-t border-border-default flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => close(false)}
                autoFocus={!opts.input}
                className="px-3 py-1.5 text-sm font-medium text-foreground-secondary hover:text-foreground transition-colors"
              >
                {opts.cancelLabel || 'Cancel'}
              </button>
              <button
                type="button"
                onClick={() => close(true)}
                className={`px-4 py-1.5 rounded-lg text-sm font-semibold text-white transition-all active:scale-95 ${
                  opts.variant === 'danger' ? 'bg-red-600 hover:bg-red-700' : 'bg-accent-500 hover:bg-accent-600'
                }`}
              >
                {opts.confirmLabel || (opts.variant === 'danger' ? 'Delete' : opts.input ? 'OK' : 'Confirm')}
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

export function usePrompt() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('usePrompt must be used within a ConfirmProvider')
  return ctx.prompt
}
