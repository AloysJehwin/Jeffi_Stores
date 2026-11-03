'use client'

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { ConfirmDialog } from '@/components/admin/kit/dialog'

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
      <ConfirmDialog
        open={open}
        title={opts.title}
        message={opts.message}
        confirmLabel={opts.confirmLabel}
        cancelLabel={opts.cancelLabel}
        variant={opts.variant}
        input={
          opts.input
            ? {
                value: inputValue,
                placeholder: opts.input.placeholder,
                onChange: v => {
                  inputRef.current = v
                  setInputValue(v)
                },
              }
            : undefined
        }
        onClose={close}
      />
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
