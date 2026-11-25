'use client'

import { type ReactNode, useCallback, useState } from 'react'
import { Check, CircleAlert, Loader2 } from 'lucide-react'
import { btnGhost, btnPrimary, inputCls } from '@/components/admin/kit/core'
import { useActionToast } from '@/components/admin/kit/toast'
import { runTest, type SaveResult } from './model'

// Building blocks shared by the Providers sections.

export const btnSmall =
  'inline-flex h-7 items-center justify-center gap-1 rounded-md border border-border-default px-2 text-xs text-foreground hover:bg-surface-secondary disabled:opacity-40 whitespace-nowrap'
export const iconBtn =
  'inline-flex h-7 w-7 items-center justify-center rounded-md text-foreground-muted hover:bg-surface-secondary hover:text-foreground disabled:pointer-events-none disabled:opacity-30'

export function Panel({ title, description, actions, children, id }: { title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section aria-labelledby={id} className="min-w-0 rounded-xl border border-border-default bg-surface-elevated p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={id} className="text-sm font-semibold uppercase tracking-wide text-foreground">
            {title}
          </h3>
          {description && <p className="mt-1 max-w-2xl text-xs text-foreground-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  )
}

export type SaveState = { saving: boolean; saved: boolean; error: string | null }

/** Saving / saved / error state for one section's Save; toasts the outcome too. */
export function useSectionSave(label: string) {
  const toast = useActionToast()
  const [state, setState] = useState<SaveState>({ saving: false, saved: false, error: null })
  const run = useCallback(
    async (fn: () => Promise<SaveResult>, after?: () => Promise<void>) => {
      setState({ saving: true, saved: false, error: null })
      const r = await fn().catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : 'Save failed' }))
      setState({ saving: false, saved: r.ok, error: r.ok ? null : r.error || 'Save failed' })
      toast.result({ ok: r.ok, text: r.ok ? `${label} saved` : r.error || 'Save failed' })
      if (r.ok && after) await after()
      return r.ok
    },
    [label, toast]
  )
  const touch = useCallback(() => setState(s => (s.saved || s.error ? { saving: false, saved: false, error: null } : s)), [])
  return { state, run, touch }
}

/** The section's Save button with its outcome beside it. */
export function SaveButton({ label = 'Save', dirty, invalid, state, onSave }: { label?: string; dirty: boolean; invalid?: boolean; state: SaveState; onSave: () => void }) {
  return (
    <div className="flex items-center gap-2">
      {state.error ? (
        <span role="alert" className="inline-flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
          <CircleAlert className="h-3.5 w-3.5" />
          {state.error}
        </span>
      ) : state.saved && !dirty ? (
        <span role="status" className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-400">
          <Check className="h-3.5 w-3.5" />
          Saved
        </span>
      ) : dirty ? (
        <span className="text-xs text-foreground-muted">Unsaved changes</span>
      ) : null}
      <button type="button" className={btnPrimary} disabled={!dirty || invalid || state.saving} onClick={onSave}>
        {state.saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {state.saving ? 'Saving…' : label}
      </button>
    </div>
  )
}

/** A dot and a short line: green when ready, amber otherwise. */
export function StatusLine({ ok, mono, children }: { ok: boolean; mono?: boolean; children: ReactNode }) {
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 text-xs ${ok ? 'text-foreground-muted' : 'text-amber-700 dark:text-amber-400'}`}>
      <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${ok ? 'bg-green-500' : 'bg-amber-500'}`} />
      <span className={`min-w-0 truncate ${mono ? 'font-mono text-[11px]' : ''}`} title={typeof children === 'string' ? children : undefined}>
        {children}
      </span>
    </span>
  )
}

export function TextField({
  label,
  help,
  value,
  onChange,
  error,
  placeholder,
  disabled,
  mono,
}: {
  label: string
  help?: string
  value: string
  onChange: (v: string) => void
  error?: string | null
  placeholder?: string
  disabled?: boolean
  mono?: boolean
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-xs text-foreground-muted">{label}</span>
      <input
        className={`${inputCls} ${mono ? 'font-mono' : ''}`}
        aria-label={label}
        aria-invalid={!!error}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        spellCheck={false}
        autoComplete="off"
        onChange={e => onChange(e.target.value)}
      />
      {error ? <span className="mt-1 block text-xs text-red-600 dark:text-red-400">{error}</span> : help ? <span className="mt-1 block text-xs text-foreground-muted">{help}</span> : null}
    </label>
  )
}

/** Runs the credentials test route for one provider (it reads the platform's secrets) and shows the result. */
export function TestButton({ provider, label = 'Test', hint, disabled }: { provider: string; label?: string; hint?: string; disabled?: boolean }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  return (
    <div className="space-y-1.5">
      <button
        type="button"
        className={btnGhost}
        disabled={disabled || busy}
        title={hint}
        onClick={async () => {
          setBusy(true)
          setResult(await runTest(provider).catch(() => ({ ok: false, message: 'Could not run the test' })))
          setBusy(false)
        }}
      >
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {busy ? 'Testing…' : label}
      </button>
      {result && (
        <p role="status" className={`flex items-start gap-1 text-xs ${result.ok ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
          {result.ok ? <Check className="mt-px h-3.5 w-3.5 shrink-0" /> : <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" />}
          {result.message}
        </p>
      )}
    </div>
  )
}
