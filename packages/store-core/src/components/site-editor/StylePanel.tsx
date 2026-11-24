'use client'

import { useState, type ReactNode } from 'react'
import { AlignCenter, AlignLeft, AlignRight, RotateCcw } from 'lucide-react'
import { paletteFrom, SHADES, type ThemeTokens } from '@jeffi/site-blocks'
import type { Breakpoint } from '@jeffi/site-blocks/design'
import { effectiveValue, readClasses, type PanelProp } from '@/lib/site/code/classes'

// The style panel: a fixed set of properties read from the element's classes at the breakpoint being edited
// (lib/site/code/classes.ts). A value set at a narrower breakpoint shows as inherited; changing it writes this
// breakpoint's class and keeps the wider breakpoints as they were. Colours are the theme's plus any hex; fonts are the
// theme's pair (docs/plans/SITE_EDITOR_PLAN.md decisions 5 and 6, recommended defaults until decided).

export const BREAKPOINT_NAME: Record<Breakpoint, string> = { base: 'Phone', sm: 'Large phone', md: 'Tablet', lg: 'Desktop', xl: 'Wide', '2xl': 'Widest' }

const SPACE = ['0', '0.5', '1', '1.5', '2', '3', '4', '5', '6', '8', '10', '12', '16', '20', '24', '32']
const SIZES = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl']
const WEIGHTS = ['light', 'normal', 'medium', 'semibold', 'bold', 'extrabold', 'black']
const WIDTHS = ['auto', 'full', 'fit', '1/2', '1/3', '2/3', '1/4', '3/4']
const MAX_WIDTHS = ['none', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', 'prose', 'full']
const HEIGHTS = ['auto', 'full', 'screen', '16', '24', '32', '48', '64', '80', '96']
const RADII = ['none', 'sm', '', 'md', 'lg', 'xl', '2xl', '3xl', 'full']
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

type Swatch = { value: string; hex: string; label: string }

/** The theme's colours as class values with a preview colour (surface and text approximate the store's defaults). */
export function themeSwatches(theme: ThemeTokens | null | undefined): Swatch[][] {
  const scales = theme ? ([['primary', theme.primary], ['accent', theme.accent], ['secondary', theme.neutral]] as const) : []
  return [
    [
      { value: 'surface', hex: '#ffffff', label: 'Page' },
      { value: 'surface-secondary', hex: '#f4f4f5', label: 'Page, tinted' },
      { value: 'foreground', hex: '#111827', label: 'Text' },
      { value: 'foreground-secondary', hex: '#374151', label: 'Text, softer' },
      { value: 'foreground-muted', hex: '#6b7280', label: 'Text, muted' },
      { value: 'white', hex: '#ffffff', label: 'White' },
      { value: 'black', hex: '#000000', label: 'Black' },
      { value: 'transparent', hex: 'transparent', label: 'None' },
    ],
    ...scales.map(([name, hex]) => {
      const p = paletteFrom(hex)
      return SHADES.map(s => ({ value: `${name}-${s}`, hex: p[s], label: `${name} ${s}` }))
    }),
  ]
}

export interface StylePanelProps {
  className: string
  bp: Breakpoint
  theme?: ThemeTokens | null
  canWrite: boolean
  onChange: (prop: PanelProp, value: string | null) => void
}

export default function StylePanel({ className, bp, theme, canWrite, onChange }: StylePanelProps) {
  const own = readClasses(className).values[bp]
  const at = (prop: PanelProp) => effectiveValue(className, bp, prop)
  const row = 'flex items-center justify-between gap-2'
  const label = 'text-xs text-foreground-secondary'
  const select = 'h-8 min-w-0 flex-1 max-w-[9.5rem] rounded-md border border-border-default bg-surface px-1.5 text-xs text-foreground disabled:opacity-60'

  /** Where a value comes from: set here (with a reset), from a narrower breakpoint, or not set. */
  const origin = (prop: PanelProp) => {
    const v = at(prop)
    if (!v) return null
    if (own[prop] !== undefined)
      return canWrite ? (
        <button type="button" onClick={() => onChange(prop, null)} title={`Clear ${BREAKPOINT_NAME[bp]}'s value`} aria-label="Clear" className="text-foreground-muted hover:text-foreground">
          <RotateCcw className="h-3 w-3" />
        </button>
      ) : null
    return <span className="text-[10px] text-foreground-muted">from {BREAKPOINT_NAME[v.from]}</span>
  }

  const pick = (prop: PanelProp, name: string, options: string[], show = (o: string) => o || 'default') => {
    const v = at(prop)?.value
    const list = v !== undefined && !options.includes(v) ? [v, ...options] : options
    return (
      <div className={row}>
        <span className={label}>{name}</span>
        <span className="flex flex-1 items-center justify-end gap-1.5">
          {origin(prop)}
          <select aria-label={name} className={select} disabled={!canWrite} value={v ?? '__'} onChange={e => onChange(prop, e.target.value === '__' ? null : e.target.value)}>
            <option value="__">—</option>
            {list.map(o => (
              <option key={o} value={o}>
                {show(o)}
              </option>
            ))}
          </select>
        </span>
      </div>
    )
  }

  const font = at('fontFamily')?.value
  const align = at('textAlign')?.value

  return (
    <div className="space-y-4">
      <p className="rounded-md bg-surface-secondary px-2 py-1.5 text-[11px] text-foreground-muted">
        Styling <b className="text-foreground">{BREAKPOINT_NAME[bp]}</b>
        {bp === 'base' ? ': wider screens keep their own look.' : `: ${bp === 'lg' ? 'phones and tablets' : 'phones'} keep theirs.`}
      </p>

      <Group title="Text">
        <div className={row}>
          <span className={label}>Font</span>
          <span className="flex flex-1 items-center justify-end gap-1.5">
            {origin('fontFamily')}
            <select
              aria-label="Font"
              className={select}
              disabled={!canWrite}
              value={font === 'display' ? 'display' : font ? font : 'body'}
              onChange={e => onChange('fontFamily', e.target.value === 'body' ? null : e.target.value)}
            >
              <option value="display">{theme?.fontDisplay ?? 'Heading font'} (headings)</option>
              <option value="body">{theme?.fontBody ?? 'Body font'} (text)</option>
              {font && font !== 'display' && <option value={font}>{font}</option>}
            </select>
          </span>
        </div>
        {pick('fontSize', 'Size', SIZES)}
        {pick('fontWeight', 'Weight', WEIGHTS)}
        <div className={row}>
          <span className={label}>Align</span>
          <span className="flex items-center gap-1.5">
            {origin('textAlign')}
            {(
              [
                ['left', AlignLeft],
                ['center', AlignCenter],
                ['right', AlignRight],
              ] as const
            ).map(([v, Icon]) => (
              <button
                key={v}
                type="button"
                disabled={!canWrite}
                aria-label={`Align ${v}`}
                aria-pressed={align === v}
                onClick={() => onChange('textAlign', v)}
                className={`rounded-md border p-1 ${align === v ? 'border-accent-500 text-accent-600' : 'border-border-default text-foreground-muted'}`}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            ))}
          </span>
        </div>
        <Colour name="Text colour" prop="textColor" value={at('textColor')?.value} theme={theme} canWrite={canWrite} onChange={onChange} origin={origin('textColor')} />
      </Group>

      <Group title="Fill">
        <Colour name="Background" prop="bgColor" value={at('bgColor')?.value} theme={theme} canWrite={canWrite} onChange={onChange} origin={origin('bgColor')} />
      </Group>

      <Group title="Spacing">
        {pick('paddingX', 'Padding, sides', SPACE)}
        {pick('paddingY', 'Padding, top and bottom', SPACE)}
        {pick('marginTop', 'Space above', SPACE)}
        {pick('marginBottom', 'Space below', SPACE)}
        {pick('gap', 'Gap between items', SPACE)}
      </Group>

      <Group title="Size">
        {pick('width', 'Width', WIDTHS)}
        {pick('maxWidth', 'Max width', MAX_WIDTHS)}
        {pick('minHeight', 'Min height', HEIGHTS)}
      </Group>

      <Group title="Corners">
        {pick('radius', 'Rounding', RADII, o => o || 'base')}
      </Group>
    </div>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">{title}</p>
      {children}
    </section>
  )
}

function Colour({
  name,
  prop,
  value,
  theme,
  canWrite,
  onChange,
  origin,
}: {
  name: string
  prop: PanelProp
  value: string | undefined
  theme?: ThemeTokens | null
  canWrite: boolean
  onChange: (prop: PanelProp, value: string | null) => void
  origin: ReactNode
}) {
  const [hex, setHex] = useState(value?.startsWith('[#') ? value.slice(1, -1) : '')
  const commitHex = () => HEX.test(hex.trim()) && onChange(prop, `[${hex.trim().toLowerCase()}]`)
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-foreground-secondary">{name}</span>
        <span className="flex items-center gap-1.5">
          {origin}
          <span className="text-[11px] text-foreground-muted">{value ?? '—'}</span>
        </span>
      </div>
      {themeSwatches(theme).map((line, i) => (
        <div key={i} className="flex flex-wrap gap-1">
          {line.map(s => (
            <button
              key={s.value}
              type="button"
              disabled={!canWrite}
              title={s.label}
              aria-label={`${name}: ${s.label}`}
              aria-pressed={value === s.value}
              onClick={() => onChange(prop, s.value)}
              className={`h-5 w-5 rounded border ${value === s.value ? 'ring-2 ring-accent-500 ring-offset-1' : 'border-border-default'}`}
              style={{ background: s.hex === 'transparent' ? 'repeating-conic-gradient(#ddd 0 25%, #fff 0 50%) 0 0 / 8px 8px' : s.hex }}
            />
          ))}
        </div>
      ))}
      <input
        aria-label={`${name}, hex`}
        disabled={!canWrite}
        placeholder="#1a2b3c"
        value={hex}
        onChange={e => setHex(e.target.value)}
        onBlur={commitHex}
        onKeyDown={e => e.key === 'Enter' && commitHex()}
        className="h-8 w-28 rounded-md border border-border-default bg-surface px-2 text-xs text-foreground disabled:opacity-60"
      />
    </div>
  )
}
