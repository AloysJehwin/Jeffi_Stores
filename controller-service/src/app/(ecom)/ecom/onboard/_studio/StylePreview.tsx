'use client'

import { Sparkles } from 'lucide-react'
import { FONT_CHOICES } from '@jeffi/site-blocks'
import { choiceCardCls, SelectedMark } from '../../_ui'
import { UI_STYLES, UI_STYLE_FONTS, type UiStyle } from '@/lib/site/studio/ui-styles'
import type { BriefReference } from '@/lib/site/studio/types'

// Small live previews: a tiny storefront drawn in a style's fonts, colours and shapes (top bar, headline, button and a
// product card), shared by the design-style picker, the look cards and the sites-you-like strip.

/** One Google Fonts stylesheet for these families (only those the themes can use). */
export function fontsLink(families: string[]): string | null {
  const known = families.map(f => FONT_CHOICES.find(c => c.name === f)).filter((f): f is (typeof FONT_CHOICES)[number] => !!f)
  if (!known.length) return null
  return `https://fonts.googleapis.com/css2?${[...new Set(known)].map(f => `family=${f.name.replace(/ /g, '+')}:wght@${f.weights}`).join('&')}&display=swap`
}

export interface MiniUiLook {
  display: string
  body: string
  bg: string
  ink: string
  primary: string
  accent: string
  radius: string
  buttonShape: string
  buttonStyle: string
  cardStyle: string
  shadow: string
  headingCase: string
  headingTracking: string
}

const RADIUS: Record<string, number> = { none: 0, sm: 4, md: 8, lg: 14, full: 18 }
const BUTTON: Record<string, number> = { square: 2, rounded: 8, pill: 999 }

/** A storefront in miniature, in a look's type, colour and shape. */
export function MiniUi({ look, title, className = '' }: { look: MiniUiLook; title: string; className?: string }) {
  const r = RADIUS[look.radius] ?? 8
  const brutal = look.cardStyle === 'outlined' && look.shadow === 'strong' && r === 0
  const card: React.CSSProperties = {
    borderRadius: r,
    background: '#ffffff',
    border: look.cardStyle === 'outlined' ? `${brutal ? 2 : 1}px solid ${brutal ? look.ink : `${look.ink}26`}` : undefined,
    boxShadow: brutal ? `4px 4px 0 0 ${look.ink}` : look.cardStyle === 'shadow' || look.shadow !== 'none' ? (look.shadow === 'strong' ? '0 8px 18px -6px rgba(0,0,0,.35)' : '0 4px 12px -6px rgba(0,0,0,.25)') : undefined,
  }
  const outline = look.buttonStyle === 'outline'
  const button: React.CSSProperties = {
    borderRadius: BUTTON[look.buttonShape] ?? 8,
    background: outline ? 'transparent' : look.primary,
    color: outline ? look.primary : '#ffffff',
    border: outline || brutal ? `${brutal ? 2 : 1.5}px solid ${brutal ? look.ink : look.primary}` : undefined,
    boxShadow: brutal ? `2px 2px 0 0 ${look.ink}` : undefined,
    fontFamily: `'${look.body}', sans-serif`,
  }
  const heading: React.CSSProperties = {
    fontFamily: `'${look.display}', serif`,
    color: look.ink,
    textTransform: look.headingCase === 'upper' ? 'uppercase' : undefined,
    letterSpacing: look.headingTracking === 'wide' ? '0.08em' : look.headingTracking === 'tight' ? '-0.02em' : undefined,
  }
  return (
    <div aria-hidden className={`overflow-hidden ${className}`} style={{ background: look.bg }}>
      <div className="flex items-center gap-1.5 px-3 py-2" style={{ borderBottom: `${brutal ? 2 : 1}px solid ${look.ink}${brutal ? '' : '1f'}` }}>
        <span className="h-3 w-3" style={{ background: look.primary, borderRadius: Math.min(r, 6) }} />
        <span className="h-1 w-6 rounded-full" style={{ background: `${look.ink}40` }} />
        <span className="h-1 w-5 rounded-full" style={{ background: `${look.ink}40` }} />
        <span className="h-1 w-4 rounded-full" style={{ background: `${look.ink}40` }} />
        <span className="ml-auto h-2.5 w-2.5 rounded-full" style={{ background: look.accent }} />
      </div>
      <div className="grid grid-cols-[1fr_auto] items-end gap-3 px-3 pb-3 pt-2.5">
        <div className="min-w-0">
          <div className="text-[9px] font-semibold uppercase tracking-[0.18em]" style={{ color: look.accent, fontFamily: `'${look.body}', sans-serif` }}>
            New in
          </div>
          <div className="truncate text-xl leading-tight" style={heading}>
            {title}
          </div>
          <div className="mt-0.5 truncate text-[10px]" style={{ color: `${look.ink}b3`, fontFamily: `'${look.body}', sans-serif` }}>
            Aa Bb Cc · {look.display} + {look.body}
          </div>
          <span className="mt-2 inline-block px-2.5 py-1 text-[10px] font-semibold" style={button}>
            Shop now
          </span>
        </div>
        <div className="w-16 shrink-0 p-1" style={card}>
          <div className="h-10" style={{ borderRadius: Math.max(0, r - 2), background: `linear-gradient(135deg, ${look.primary}33, ${look.accent}55)` }} />
          <div className="mt-1 h-1 w-10 rounded-full" style={{ background: `${look.ink}55` }} />
          <div className="mt-1 h-1 w-6 rounded-full" style={{ background: look.primary }} />
        </div>
      </div>
    </div>
  )
}

const styleLook = (s: UiStyle): MiniUiLook => ({ display: s.fonts[0][0], body: s.fonts[0][1], ...s.sample, ...s.tokens })

/** The design-style question: each style as a live preview card, or "let the AI choose". */
export function StylePicker({ value, onChange, storeName }: { value: string | null; onChange: (id: string | null) => void; storeName: string }) {
  const href = fontsLink(UI_STYLE_FONTS)
  return (
    <div>
      {href && <link rel="stylesheet" href={href} />}
      <div role="radiogroup" aria-label="Design style" className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <button type="button" role="radio" aria-checked={value === null} onClick={() => onChange(null)} className={`${choiceCardCls(value === null)} relative flex min-h-[9.5rem] flex-col items-start justify-between p-4 text-left`}>
          <Sparkles className="h-5 w-5 org-brown" />
          <span>
            <span className="block text-sm font-semibold text-foreground">Let the AI choose</span>
            <span className="mt-0.5 block text-xs text-foreground-secondary">Three different styles to compare</span>
          </span>
          {value === null && <SelectedMark className="absolute right-3 top-3" />}
        </button>
        {UI_STYLES.map(s => (
          <button key={s.id} type="button" role="radio" aria-checked={value === s.id} onClick={() => onChange(s.id)} className={`${choiceCardCls(value === s.id)} relative flex flex-col overflow-hidden text-left`}>
            <MiniUi look={styleLook(s)} title={storeName} />
            <span className="block px-3 py-2">
              <span className="block text-sm font-semibold text-foreground">{s.name}</span>
              <span className="block text-xs text-foreground-secondary">{s.blurb}</span>
            </span>
            {value === s.id && <SelectedMark className="absolute right-2 top-2" />}
          </button>
        ))}
      </div>
    </div>
  )
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** What the studio took from the sites the owner likes: colours, type and layout, as a small preview each. */
export function ReferenceStrip({ references }: { references: BriefReference[] }) {
  if (!references.length) return null
  const href = fontsLink(references.flatMap(r => [r.fonts.display, r.fonts.body].filter((f): f is string => !!f)))
  return (
    <div className="mt-4 rounded-2xl border border-border-default bg-surface-elevated p-4">
      {href && <link rel="stylesheet" href={href} />}
      <div className="text-xs font-semibold uppercase tracking-widest text-foreground-muted">From the sites you like</div>
      <ul className="mt-2 space-y-3">
        {references.map(r => (
          <li key={r.url} className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="min-w-[8rem] text-sm font-semibold text-foreground">{host(r.url)}</span>
            {r.colors.length > 0 ? (
              <span className="flex" aria-label={`Colours: ${r.colors.slice(0, 5).join(', ')}`}>
                {r.colors.slice(0, 5).map(c => (
                  <span key={c} className="-ml-1 h-6 w-6 rounded-full border-2 border-surface-elevated first:ml-0" style={{ background: c }} title={c} />
                ))}
              </span>
            ) : (
              <span className="text-xs text-foreground-muted">No colours read</span>
            )}
            {r.fonts.display ? (
              <span className="flex items-baseline gap-1.5">
                <span className="text-lg leading-none text-foreground" style={{ fontFamily: `'${r.fonts.display}', serif` }}>
                  Aa
                </span>
                <span className="text-xs text-foreground-muted">{r.fonts.display}</span>
              </span>
            ) : null}
            <span className="flex flex-wrap gap-1.5">
              {[r.density, r.imageLed ? 'picture-led' : 'type-led', ...(r.uppercaseLabels ? ['uppercase labels'] : [])].map(t => (
                <span key={t} className="rounded-full bg-surface-secondary px-2 py-0.5 text-[11px] text-foreground-secondary">
                  {t}
                </span>
              ))}
            </span>
            {r.feel && <p className="w-full text-xs text-foreground-secondary">{r.feel}</p>}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-foreground-muted">The AI takes their colours, type and layout feel, never their words or pictures. One look is built from them.</p>
    </div>
  )
}
