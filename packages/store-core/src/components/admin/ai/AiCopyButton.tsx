'use client'

import { useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import type { AIFillField } from '@/components/admin/AIFillForm'
import { useCanUseAi, useCanWrite } from '@/contexts/AdminScopesContext'
import { useToast } from '@/contexts/ToastContext'
import type { AiActionScope } from '@/lib/auth/ai-scope'

interface Props {
  /** The write scope of the copy; the button hides without it or without AI on the plan. */
  scope: AiActionScope
  /** What the copy is for, sent ahead of the brief. */
  context: string
  /** Prefills the brief, e.g. the offer title. */
  defaultBrief?: string
  fields: AIFillField[]
  /** Only the fields the AI filled, trimmed. */
  onFill: (values: Record<string, string>) => void
  label?: string
  className?: string
  disabled?: boolean
}

const btn =
  'control-md inline-flex items-center gap-1.5 border border-border-default text-xs font-semibold text-foreground hover:bg-surface-secondary disabled:opacity-50'

/** "Write with AI": one brief fills copy fields through /api/admin/ai-fill-form; media is left alone. */
export default function AiCopyButton({
  scope,
  context,
  defaultBrief = '',
  fields,
  onFill,
  label = 'Write with AI',
  className,
  disabled,
}: Props) {
  const canWrite = useCanWrite(scope)
  const canUseAi = useCanUseAi(scope)
  const { showToast } = useToast()
  const [open, setOpen] = useState(false)
  const [brief, setBrief] = useState('')
  const [busy, setBusy] = useState(false)

  async function write() {
    const text = brief.trim()
    if (text.length < 3 || busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/ai-fill-form', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ scenario: `${context} Scenario: ${text}`, fields, scope }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.fields) {
        showToast(data.error || 'Copy generation failed', 'error')
        return
      }
      const out: Record<string, string> = {}
      for (const f of fields) {
        const v = (data.fields as Record<string, unknown>)[f.name]
        if (typeof v === 'string' && v.trim()) out[f.name] = v.trim()
      }
      if (Object.keys(out).length === 0) {
        showToast('No copy came back. Try a fuller brief.', 'error')
        return
      }
      onFill(out)
      setOpen(false)
      showToast('Copy written', 'success')
    } catch {
      showToast('Copy generation failed', 'error')
    } finally {
      setBusy(false)
    }
  }

  if (!canWrite || !canUseAi) return null

  if (!open)
    return (
      <div className={className}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setBrief(defaultBrief)
            setOpen(true)
          }}
          className={btn}
        >
          <Sparkles className="h-3.5 w-3.5" />
          {label}
        </button>
      </div>
    )

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className ?? ''}`}>
      <input
        type="text"
        autoFocus
        value={brief}
        disabled={busy}
        aria-label="Brief for the AI"
        placeholder="What is it about? e.g. Diwali sale on power tools"
        onChange={e => setBrief(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            write()
          }
          if (e.key === 'Escape') setOpen(false)
        }}
        className="min-w-0 flex-1 rounded-lg border border-border-secondary bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500 disabled:opacity-60"
      />
      <button type="button" onClick={write} disabled={busy || brief.trim().length < 3} className={btn}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        {busy ? 'Writing…' : 'Write'}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        disabled={busy}
        className="text-[11px] text-foreground-muted underline hover:text-foreground"
      >
        Cancel
      </button>
    </div>
  )
}
