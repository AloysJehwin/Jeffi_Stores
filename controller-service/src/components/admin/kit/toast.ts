'use client'

import { useMemo } from 'react'
import { useToastOptional } from '@/contexts/ToastContext'

// Action responses (save, sync, refresh, connect, delete, send, import) are toasts, never inline
// banners. Inline messages are only for persistent state (field errors, "needs reconnect", empty).

export type ToastKind = 'success' | 'error' | 'info' | 'warning'

/** Anything an action returns: `{ ok, text }` banners, api() results, or raw fetch JSON. */
export type ActionResult = {
  ok: boolean
  text?: string
  message?: string
  error?: string
  data?: { error?: string; message?: string } | null
}

/** Picks the message and tone for a result; exported for tests and non-hook callers. */
export function resultToast(res: ActionResult, opts: { success?: string; error?: string; warning?: boolean } = {}): { kind: ToastKind; text: string } {
  if (res.ok) {
    const text = opts.success ?? res.text ?? res.message ?? res.data?.message ?? 'Done.'
    return { kind: opts.warning ? 'warning' : 'success', text }
  }
  const text = res.text ?? res.error ?? res.data?.error ?? res.message ?? opts.error ?? 'Something went wrong.'
  return { kind: 'error', text }
}

export interface ActionToast {
  success: (text: string) => void
  error: (text: string) => void
  info: (text: string) => void
  warning: (text: string) => void
  /** Show a result: green when ok, red otherwise. `success`/`error` override the message. */
  result: (res: ActionResult, opts?: { success?: string; error?: string; warning?: boolean }) => void
}

/** Toasts for action responses. A no-op outside a ToastProvider (isolated component tests). */
export function useActionToast(): ActionToast {
  const ctx = useToastOptional()
  const show = ctx?.showToast
  return useMemo(() => {
    const say = (kind: ToastKind) => (text: string) => show?.(text, kind)
    return {
      success: say('success'),
      error: say('error'),
      info: say('info'),
      warning: say('warning'),
      result: (res, opts) => {
        const t = resultToast(res, opts)
        show?.(t.text, t.kind)
      },
    }
  }, [show])
}
