'use client'

import { useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'

// "Change with AI" on the selection: what to change, in the owner's words. The change lands as one undoable step and
// the elements it touched light up on the canvas.

export default function AiBox({ target, note, busy, onAsk }: { target: string; note?: string; busy: boolean; onAsk: (instruction: string) => void }) {
  const [text, setText] = useState('')
  const ask = () => text.trim().length >= 3 && !busy && onAsk(text.trim())
  return (
    <section className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Change with AI</p>
      <textarea
        aria-label={`What to change in ${target}`}
        className="w-full rounded-lg border border-border-default bg-surface px-2.5 py-2 text-sm text-foreground focus:border-accent-500 focus:outline-none disabled:opacity-60"
        rows={2}
        maxLength={600}
        disabled={busy}
        value={text}
        placeholder={`e.g. Make ${target.toLowerCase()} shorter and bolder`}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && ask()}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        {note ? <span className="text-[11px] text-foreground-muted">{note}</span> : <span />}
        <button type="button" disabled={busy || text.trim().length < 3} onClick={ask} className="inline-flex items-center gap-1.5 rounded-md bg-accent-500 px-2.5 h-7 text-xs font-medium text-white disabled:opacity-50">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} {busy ? 'Changing…' : 'Change'}
        </button>
      </div>
    </section>
  )
}
