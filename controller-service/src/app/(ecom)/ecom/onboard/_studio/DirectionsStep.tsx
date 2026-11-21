'use client'

import { useState } from 'react'
import { ArrowLeft, Loader2, RefreshCw, Shuffle, Sparkles } from 'lucide-react'
import { paletteFrom } from '@jeffi/site-blocks'
import { choiceCardCls, SelectedMark } from '../../_ui'
import { fieldInput, fieldRow, ghostBtn, secondaryBtn } from '../ui'
import type { DesignDirection } from '@/lib/site/studio/types'
import { MiniUi } from './StylePreview'

// Design directions: three looks, each with its palette, its font pair shown in those fonts and a layout feel. The
// owner can shuffle a look's colours, ask for a different look, or say what they want in their own words.

function DirectionCard({
  d,
  storeName,
  selected,
  busy,
  onSelect,
  onShuffle,
  onNew,
  disabled,
}: {
  d: DesignDirection
  storeName: string
  selected: boolean
  busy: 'shuffle' | 'new' | null
  onSelect: () => void
  onShuffle: () => void
  onNew: () => void
  disabled: boolean
}) {
  const t = d.theme
  const p = paletteFrom(t.primary)
  const a = paletteFrom(t.accent)
  const n = paletteFrom(t.neutral)
  const swatches = [p[600], p[500], p[100], a[500], n[700], n[50]]
  return (
    <div className={`${choiceCardCls(selected)} flex flex-col overflow-hidden bg-surface-elevated`}>
      <button type="button" onClick={onSelect} disabled={disabled} aria-pressed={selected} className="ecom-focus flex flex-1 flex-col text-left disabled:cursor-not-allowed">
        <div className="relative">
          <MiniUi
            title={storeName}
            className="min-h-[8.5rem]"
            look={{ display: t.fontDisplay, body: t.fontBody, bg: n[50], ink: n[900], primary: p[500], accent: a[500], radius: t.radius, buttonShape: t.buttonShape, buttonStyle: t.buttonStyle, cardStyle: t.cardStyle, shadow: t.shadow, headingCase: t.headingCase, headingTracking: t.headingTracking }}
          />
        </div>
        <div className="flex h-7" aria-label={`Palette: ${t.primary}, ${t.accent}, ${t.neutral}`}>
          {swatches.map((c, i) => (
            <span key={i} className="flex-1" style={{ background: c }} />
          ))}
        </div>
        <div className="flex-1 p-4 pr-10">
          {d.reference && <span className="mb-1.5 inline-block rounded-full org-sand px-2 py-0.5 text-[11px] font-semibold text-foreground-secondary">From {d.reference}</span>}
          <div className="text-sm font-semibold text-foreground">{d.name}</div>
          <p className="mt-1 line-clamp-5 text-xs text-foreground-secondary" title={d.layoutFeel}>
            {d.layoutFeel}
          </p>
          <p className="mt-2 line-clamp-3 text-xs text-foreground-muted" title={d.rationale}>
            {d.rationale}
          </p>
        </div>
      </button>
      {selected && <SelectedMark className="absolute right-3 top-3" />}
      <div className="flex border-t border-border-default">
        <button type="button" onClick={onShuffle} disabled={disabled || !!busy} className="ecom-focus ecom-hover flex flex-1 items-center justify-center gap-1.5 px-2 py-2.5 text-xs font-semibold text-foreground-secondary hover:text-foreground disabled:opacity-40">
          {busy === 'shuffle' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Shuffle className="h-3.5 w-3.5" />} Shuffle colours
        </button>
        <button type="button" onClick={onNew} disabled={disabled || !!busy} className="ecom-focus ecom-hover flex flex-1 items-center justify-center gap-1.5 border-l border-border-default px-2 py-2.5 text-xs font-semibold text-foreground-secondary hover:text-foreground disabled:opacity-40">
          {busy === 'new' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} New direction
        </button>
      </div>
    </div>
  )
}

export default function DirectionsStep({
  directions,
  chosenId,
  storeName,
  locked,
  onChoose,
  onShuffle,
  onNew,
  onAsk,
  onBack,
  footer,
}: {
  directions: DesignDirection[]
  chosenId: string | null
  storeName: string
  locked: boolean
  onChoose: (i: number) => Promise<void>
  onShuffle: (i: number) => Promise<void>
  onNew: (i: number, ask?: string) => Promise<void>
  onAsk: (ask: string) => Promise<void>
  onBack: () => void
  footer: React.ReactNode
}) {
  const [busy, setBusy] = useState<{ i: number; kind: 'shuffle' | 'new' } | null>(null)
  const [ask, setAsk] = useState('')
  const [asking, setAsking] = useState(false)
  const run = async (i: number, kind: 'shuffle' | 'new') => {
    setBusy({ i, kind })
    try {
      await (kind === 'shuffle' ? onShuffle(i) : onNew(i, ask.trim() || undefined))
    } finally {
      setBusy(null)
    }
  }
  return (
    <div>
      {/* Each look's fonts, so the pairs show in their own type. */}
      {directions.map(d => (
        <link key={d.id} rel="stylesheet" href={d.fontsHref} />
      ))}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {directions.map((d, i) => (
          <DirectionCard
            key={d.id}
            d={d}
            storeName={storeName}
            selected={d.id === chosenId}
            busy={busy?.i === i ? busy.kind : null}
            disabled={locked || asking}
            onSelect={() => onChoose(i)}
            onShuffle={() => run(i, 'shuffle')}
            onNew={() => run(i, 'new')}
          />
        ))}
      </div>

      {!locked && (
        <form
          noValidate
          className="mt-5 flex flex-col gap-2 sm:flex-row"
          onSubmit={async e => {
            e.preventDefault()
            if (!ask.trim()) return
            setAsking(true)
            try {
              await onAsk(ask.trim())
            } finally {
              setAsking(false)
            }
          }}
        >
          <label htmlFor="studio-ask" className="sr-only">
            Describe the look you want
          </label>
          <input
            id="studio-ask"
            className={`${fieldInput} flex-1`}
            maxLength={300}
            value={ask}
            onChange={e => setAsk(e.target.value)}
            placeholder="Or say what you want: darker, a serif, more green…"
          />
          <button type="submit" disabled={asking || !ask.trim()} className={`${secondaryBtn} ${fieldRow}`}>
            {asking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {asking ? 'Designing…' : 'Show new looks'}
          </button>
        </form>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={onBack} className={ghostBtn}>
          <ArrowLeft className="h-4 w-4" /> Pages
        </button>
        {footer}
      </div>
    </div>
  )
}

