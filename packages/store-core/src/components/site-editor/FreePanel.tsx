'use client'

import { useState } from 'react'
import { ArrowDownToLine, ArrowUpToLine, ChevronDown, ChevronUp, Undo2 } from 'lucide-react'
import type { Breakpoint } from '@jeffi/site-blocks/design'
import type { FreeLayer, FreeRect } from '@/lib/site/code/free'
import { BREAKPOINT_NAME } from './StylePanel'

// A free layer's place in its frame at the breakpoint being edited, in %: typed, or dragged on the canvas. Below the
// breakpoint it is placed at, it sits in the flow at its place in the page unless placed there too.

export interface FreePanelProps {
  layer: FreeLayer
  bp: Breakpoint
  canWrite: boolean
  onRect: (rect: FreeRect) => void
  onRestack: (dir: 'front' | 'back' | 'forward' | 'backward') => void
  onFlow: () => void
}

const FIELDS: [keyof FreeRect, string][] = [
  ['left', 'Left'],
  ['top', 'Top'],
  ['width', 'Width'],
  ['height', 'Height'],
]

export default function FreePanel({ layer, bp, canWrite, onRect, onRestack, onFlow }: FreePanelProps) {
  const btn = 'inline-flex items-center gap-1 rounded-md border border-border-default px-2 h-7 text-xs text-foreground-secondary hover:text-foreground disabled:opacity-40'
  const inherited = layer.from !== bp
  return (
    <section className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Free placement</p>
      <p className="text-[11px] text-foreground-muted">
        {inherited ? `Placed on ${BREAKPOINT_NAME[layer.from]}; changing it here places it on ${BREAKPOINT_NAME[bp]} too.` : `Placed on ${BREAKPOINT_NAME[bp]}.`} Drag it or its handles on the
        canvas; arrow keys nudge it. Narrower screens show it in the flow unless placed there too.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {FIELDS.map(([k, label]) => (
          <PctField key={`${k}:${layer.rect[k] ?? ''}`} label={label} value={layer.rect[k]} disabled={!canWrite} onCommit={v => onRect({ ...layer.rect, [k]: v })} />
        ))}
      </div>
      {canWrite && (
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className={btn} onClick={() => onRestack('front')} aria-label="Bring to front">
            <ArrowUpToLine className="h-3.5 w-3.5" /> Front
          </button>
          <button type="button" className={btn} onClick={() => onRestack('forward')} aria-label="Bring forward">
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button type="button" className={btn} onClick={() => onRestack('backward')} aria-label="Send backward">
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <button type="button" className={btn} onClick={() => onRestack('back')} aria-label="Send to back">
            <ArrowDownToLine className="h-3.5 w-3.5" /> Back
          </button>
          <button type="button" className={btn} onClick={onFlow}>
            <Undo2 className="h-3.5 w-3.5" /> Back in the flow
          </button>
        </div>
      )}
    </section>
  )
}

/** A percentage, written in on blur or Enter; Height may be left empty (as tall as its content). */
function PctField({ label, value, disabled, onCommit }: { label: string; value: number | undefined; disabled: boolean; onCommit: (v: number | undefined) => void }) {
  const [draft, setDraft] = useState(value === undefined ? '' : String(value))
  const commit = () => {
    const t = draft.trim()
    if (t === '' && label === 'Height') return value !== undefined && onCommit(undefined)
    const n = Number(t)
    if (Number.isFinite(n) && n !== value) onCommit(Math.max(-100, Math.min(200, n)))
  }
  return (
    <label className="flex items-center gap-1.5">
      <span className="w-12 text-xs text-foreground-secondary">{label}</span>
      <input
        inputMode="decimal"
        aria-label={`${label} (%)`}
        className="h-8 w-16 rounded-md border border-border-default bg-surface px-2 text-xs text-foreground disabled:opacity-60"
        value={draft}
        placeholder={label === 'Height' ? 'auto' : undefined}
        disabled={disabled}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => e.key === 'Enter' && commit()}
      />
      <span className="text-xs text-foreground-muted">%</span>
    </label>
  )
}
