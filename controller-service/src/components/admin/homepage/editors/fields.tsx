'use client'

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import AdminSelect from '@/components/admin/AdminSelect'
import AIEnrichButton from '@/components/admin/AIEnrichButton'
import MediaField, { type MediaSize } from '@/components/admin/media/MediaField'
import DateTimePicker from '@/components/ui/DateTimePicker'
import Toggle from '@/components/ui/Toggle'
import { useCanUseAi } from '@/contexts/AdminScopesContext'
import type { AiActionScope } from '@/lib/auth/ai-scope'
import {
  PLACEMENT_MIN_EVERY,
  SECTION_ASPECTS,
  SECTION_META,
  businessVisitorView,
  sectionAspectValue,
  sectionLayout,
  sectionLimit,
  sectionCopyDefaults,
  sectionPlacement,
  type HomepageSection,
  type SectionCopy,
  type SectionType,
} from '@/lib/catalog/homepage-sections'

/** Live catalogue data loaded server-side, so an editor never shows an empty picker. */
export interface SectionOptions {
  categories: { value: string; label: string }[]
  brands: { value: string; label: string }[]
  /** Top-level categories by id, for sections that pick whole departments (category tabs). */
  topCategories?: { value: string; label: string }[]
  counts: {
    featured: number
    newArrivals: number
    bestSellers: number
    onSale: number
    bundles?: number
    approvedReviews?: number
  }
  /** Store-specific storefront defaults, e.g. the About story from the store settings. */
  copyDefaults?: Partial<Record<SectionType, SectionCopy>>
  /** Store-specific built-in tiles, e.g. the About stats from the store settings. */
  tileDefaults?: Partial<Record<SectionType, Record<string, string>[]>>
}

export interface EditorProps {
  section: HomepageSection
  canWrite: boolean
  options?: SectionOptions
  onChange: (id: string, patch: Partial<HomepageSection>) => void
  onSave: (id: string, body: Record<string, unknown>) => Promise<void>
}

export const INPUT_CLASS =
  'w-full px-3 py-2 text-sm border border-border-secondary rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500 disabled:opacity-60'

export const LABEL_CLASS = 'block text-xs font-medium text-foreground mb-1'

export const LAYOUT_OPTIONS = [
  { value: 'grid', label: 'Grid' },
  { value: 'carousel', label: 'Carousel (scrolls sideways)' },
]

// Reordering a tile list swaps the underlying values while React keeps the same component
// instance, so the draft must follow an external change — but never while focused, or an
// autosave round-trip would overwrite what the user is mid-way through typing.
function useExternalValue(value: string) {
  const [draft, setDraft] = useState(value)
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setDraft(value)
  }, [value])
  return { draft, setDraft, focused }
}

const LIVE_DEFAULT_NOTE = 'Live default. Edit to change it; clear it to restore the default.'

interface AiCopy {
  scope: AiActionScope
  context: string
}

const AiCopyContext = createContext<AiCopy>({ scope: 'settings:write', context: 'Storefront homepage copy.' })

/** What the AI sparkle on the Text and TextArea fields inside is told; nesting appends detail. */
export function AiCopyScope({
  context,
  scope,
  children,
}: {
  context: string
  scope?: AiActionScope
  children: React.ReactNode
}) {
  const parent = useContext(AiCopyContext)
  const value = useMemo(
    () => ({ scope: scope ?? parent.scope, context: `${parent.context} ${context}` }),
    [parent, scope, context]
  )
  return <AiCopyContext.Provider value={value}>{children}</AiCopyContext.Provider>
}

interface CopyFieldProps {
  label: string
  value: string
  disabled: boolean
  hint?: string
  /** False for fields that are not copy (links, ids, numbers): no AI sparkle. */
  ai?: boolean
  maxLength?: number
  /** Added to the section's AI context for this field, e.g. which tile it belongs to. */
  aiContext?: string
  onCommit: (v: string) => void
}

function useSparkle(ai: boolean, disabled: boolean) {
  const copy = useContext(AiCopyContext)
  return { ...copy, on: useCanUseAi(copy.scope) && ai && !disabled }
}

/** Wraps a copy input with the AI sparkle; the result is committed straight away. */
function Sparkle({
  sparkle,
  label,
  hint,
  placeholder,
  maxLength,
  aiContext,
  value,
  multiline,
  onChange,
  children,
}: Omit<CopyFieldProps, 'disabled' | 'ai' | 'onCommit'> & {
  sparkle: ReturnType<typeof useSparkle>
  placeholder?: string
  multiline?: boolean
  onChange: (v: string) => void
  children: React.ReactNode
}) {
  if (!sparkle.on) return <>{children}</>
  const note = hint?.replace(LIVE_DEFAULT_NOTE, '').trim()
  const context = [sparkle.context, aiContext, note, placeholder && `Example: ${placeholder}.`]
    .filter(Boolean)
    .join(' ')
  // Tokens the hint or example names, e.g. {amount} in the trust strip, are filled in by the storefront.
  const variables = [...new Set([...context.matchAll(/\{(\w+)\}/g)].map(m => m[1]))]
  return (
    <AIEnrichButton
      fieldLabel={/^eyebrow$/i.test(label) ? 'Eyebrow: a tiny label above the heading, 1-3 words' : label}
      value={value}
      onChange={onChange}
      scope={sparkle.scope}
      format={/button/i.test(label) ? 'label' : 'plain'}
      maxLength={maxLength}
      multiline={multiline}
      write
      context={context}
      variables={variables}
    >
      {children}
    </AIEnrichButton>
  )
}

export function Text({
  label,
  value,
  disabled,
  hint,
  placeholder,
  ai = true,
  maxLength,
  aiContext,
  onCommit,
}: CopyFieldProps & { placeholder?: string }) {
  const { draft, setDraft, focused } = useExternalValue(value)
  const sparkle = useSparkle(ai, disabled)
  return (
    <div>
      <label className={LABEL_CLASS}>{label}</label>
      <Sparkle
        sparkle={sparkle}
        label={label}
        hint={hint}
        placeholder={placeholder}
        maxLength={maxLength}
        aiContext={aiContext}
        value={draft}
        onChange={v => {
          setDraft(v)
          if (v !== value) onCommit(v)
        }}
      >
        <input
          type="text"
          value={draft}
          disabled={disabled}
          placeholder={placeholder}
          onFocus={() => {
            focused.current = true
          }}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => {
            focused.current = false
            if (draft !== value) onCommit(draft)
          }}
          className={sparkle.on ? `${INPUT_CLASS} pr-9` : INPUT_CLASS}
        />
      </Sparkle>
      {hint && <p className="text-[11px] text-foreground-muted mt-1">{hint}</p>}
    </div>
  )
}

/**
 * A config media slot: upload, gallery or AI, plus a pasted link. With `allowVideo` it also binds the
 * sibling video key and commits both together, so neither write overwrites the other.
 */
export function Image({
  label,
  value,
  video = '',
  allowVideo = false,
  size = 'wide',
  defaultPrompt,
  disabled,
  hint,
  placeholder,
  onCommit,
}: {
  label: string
  value: string
  /** The sibling video key's value. */
  video?: string
  allowVideo?: boolean
  size?: MediaSize | MediaSize[]
  defaultPrompt?: string
  disabled: boolean
  hint?: string
  placeholder?: string
  /** The image URL, then the video URL ('' when cleared; passed through when the slot takes no video). */
  onCommit: (image: string, video: string) => void
}) {
  const { draft, setDraft, focused } = useExternalValue(value)
  return (
    <div className="sm:col-span-2 space-y-1.5">
      <MediaField
        label={label}
        hint={hint}
        value={{ image: value || null, video: allowVideo ? video || null : null }}
        onChange={next => onCommit(next.image ?? '', allowVideo ? (next.video ?? '') : video)}
        size={size}
        allowVideo={allowVideo}
        defaultPrompt={defaultPrompt}
        disabled={disabled}
      />
      <input
        type="text"
        value={draft}
        disabled={disabled}
        aria-label={`${label} link`}
        placeholder={placeholder ?? 'Or paste an image link: https://… or /images/…'}
        onFocus={() => {
          focused.current = true
        }}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => {
          focused.current = false
          if (draft !== value) onCommit(draft.trim(), video)
        }}
        className={`${INPUT_CLASS} text-xs`}
      />
    </div>
  )
}

export function TextArea({
  label,
  value,
  disabled,
  hint,
  rows = 3,
  ai = true,
  maxLength,
  aiContext,
  onCommit,
}: CopyFieldProps & { rows?: number }) {
  const { draft, setDraft, focused } = useExternalValue(value)
  const sparkle = useSparkle(ai, disabled)
  return (
    <div>
      <label className={LABEL_CLASS}>{label}</label>
      <Sparkle
        sparkle={sparkle}
        label={label}
        hint={hint}
        maxLength={maxLength}
        aiContext={aiContext}
        value={draft}
        multiline
        onChange={v => {
          setDraft(v)
          if (v !== value) onCommit(v)
        }}
      >
        <textarea
          value={draft}
          rows={rows}
          disabled={disabled}
          onFocus={() => {
            focused.current = true
          }}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => {
            focused.current = false
            if (draft !== value) onCommit(draft)
          }}
          className={`${INPUT_CLASS} resize-none${sparkle.on ? ' pr-9' : ''}`}
        />
      </Sparkle>
      {hint && <p className="text-[11px] text-foreground-muted mt-1">{hint}</p>}
    </div>
  )
}

export function NumberField({
  label,
  value,
  disabled,
  hint,
  min = 1,
  onCommit,
}: {
  label: string
  value: number
  disabled: boolean
  hint?: string
  min?: number
  onCommit: (v: number) => void
}) {
  const { draft, setDraft, focused } = useExternalValue(String(value))
  return (
    <div>
      <label className={LABEL_CLASS}>{label}</label>
      <input
        type="number"
        min={min}
        value={draft}
        disabled={disabled}
        onFocus={() => {
          focused.current = true
        }}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => {
          focused.current = false
          const n = parseInt(draft, 10)
          if (!Number.isFinite(n) || n < min) {
            setDraft(String(value))
            return
          }
          if (n !== value) onCommit(n)
        }}
        className={INPUT_CLASS}
      />
      {hint && <p className="text-[11px] text-foreground-muted mt-1">{hint}</p>}
    </div>
  )
}

export function Select({
  label,
  value,
  options,
  disabled,
  hint,
  placeholder,
  onChange,
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  disabled: boolean
  hint?: string
  placeholder?: string
  onChange: (v: string) => void
}) {
  return (
    <div>
      <label className={LABEL_CLASS}>{label}</label>
      <AdminSelect
        value={value}
        options={options}
        disabled={disabled}
        placeholder={placeholder}
        onChange={onChange}
        sm
      />
      {hint && <p className="text-[11px] text-foreground-muted mt-1">{hint}</p>}
    </div>
  )
}

// The API stores a full ISO timestamp but DateTimePicker speaks local `YYYY-MM-DDTHH:mm`.
function isoToLocal(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function localToIso(local: string): string | null {
  if (!local) return null
  const d = new Date(local)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function DateTimeField({
  label,
  value,
  disabled,
  hint,
  placeholder,
  onCommit,
}: {
  label: string
  value: string | null
  disabled: boolean
  hint?: string
  placeholder?: string
  onCommit: (v: string | null) => void
}) {
  return (
    <div>
      <label className={LABEL_CLASS}>{label}</label>
      <DateTimePicker
        value={isoToLocal(value)}
        disabled={disabled}
        placeholder={placeholder}
        className="w-full"
        onChange={v => onCommit(localToIso(v))}
      />
      {hint && <p className="text-[11px] text-foreground-muted mt-1">{hint}</p>}
    </div>
  )
}

export function ToggleField({
  label,
  checked,
  disabled,
  hint,
  onChange,
}: {
  label: string
  checked: boolean
  disabled: boolean
  hint?: string
  onChange: (v: boolean) => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3 min-h-[38px]">
        <span className={`${LABEL_CLASS} mb-0`}>{label}</span>
        <Toggle checked={checked} disabled={disabled} onChange={onChange} />
      </div>
      {hint && <p className="text-[11px] text-foreground-muted mt-1">{hint}</p>}
    </div>
  )
}

export function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>
}

export function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="sm:col-span-2 text-xs text-foreground-muted rounded-lg border border-border-default bg-surface-secondary/40 px-3 py-2">
      {children}
    </p>
  )
}

/** Field helpers bound to one section: column fields go to the row, config fields to `config`. */
export function useSectionBinding({ section, onChange, onSave }: EditorProps) {
  const cfg = (section.config ?? {}) as Record<string, unknown>

  function saveConfig(patch: Record<string, unknown>) {
    const next = { ...cfg, ...patch }
    onChange(section.id, { config: next })
    onSave(section.id, { config: next })
  }

  function saveColumn(patch: Partial<HomepageSection>, body: Record<string, unknown>) {
    onChange(section.id, patch)
    onSave(section.id, body)
  }

  // A cleared field is stored as null so the storefront falls back to its default copy.
  const text = (v: string) => (v.trim() ? v : null)

  return {
    cfg,
    saveConfig,
    saveColumn,
    str: (key: string) => String(cfg[key] ?? ''),
    limit: sectionLimit(section),
    layout: sectionLayout(section),
    eyebrow: (v: string) => saveColumn({ eyebrow: text(v) }, { eyebrow: text(v) }),
    title: (v: string) => saveColumn({ title: text(v) }, { title: text(v) }),
    subtitle: (v: string) => saveColumn({ subtitle: text(v) }, { subtitle: text(v) }),
    ctaLabel: (v: string) => saveColumn({ cta_label: text(v) }, { ctaLabel: text(v) }),
    ctaUrl: (v: string) => saveColumn({ cta_url: text(v) }, { ctaUrl: text(v) }),
  }
}

/** The copy the storefront shows for this section when a field is left empty. */
export function sectionCopy({ section, options }: EditorProps): SectionCopy {
  return { ...sectionCopyDefaults(section.type), ...options?.copyDefaults?.[section.type] }
}

/** Hint for a field that is showing the storefront default rather than a saved value. */
export function copyHint(showingDefault: boolean, hint?: string): string | undefined {
  if (!showingDefault) return hint
  return hint ? `${hint} ${LIVE_DEFAULT_NOTE}` : LIVE_DEFAULT_NOTE
}

export function HeadingFields({ props, eyebrowHint }: { props: EditorProps; eyebrowHint?: string }) {
  const b = useSectionBinding(props)
  const d = sectionCopy(props)
  const { section, canWrite } = props
  return (
    <>
      <Text
        label="Eyebrow"
        value={section.eyebrow ?? d.eyebrow ?? ''}
        disabled={!canWrite}
        hint={copyHint(section.eyebrow == null && !!d.eyebrow, eyebrowHint)}
        maxLength={100}
        onCommit={b.eyebrow}
      />
      <Text
        label="Heading"
        value={section.title ?? d.title ?? ''}
        disabled={!canWrite}
        hint={copyHint(section.title == null && !!d.title)}
        maxLength={255}
        onCommit={b.title}
      />
    </>
  )
}

export function CtaFields({
  props,
  hint,
  urlPlaceholder = '/products',
}: {
  props: EditorProps
  hint?: string
  urlPlaceholder?: string
}) {
  const b = useSectionBinding(props)
  const d = sectionCopy(props)
  const { section, canWrite } = props
  return (
    <>
      <Text
        label="Button label"
        value={section.cta_label ?? d.ctaLabel ?? ''}
        disabled={!canWrite}
        placeholder="Shop all"
        hint={copyHint(section.cta_label == null && !!d.ctaLabel)}
        maxLength={100}
        onCommit={b.ctaLabel}
      />
      <Text
        label="Button link"
        value={section.cta_url ?? d.ctaUrl ?? ''}
        disabled={!canWrite}
        placeholder={urlPlaceholder}
        hint={copyHint(section.cta_url == null && !!d.ctaUrl, hint)}
        ai={false}
        onCommit={b.ctaUrl}
      />
    </>
  )
}

export function LayoutField({ props }: { props: EditorProps }) {
  const b = useSectionBinding(props)
  return (
    <Select
      label="Layout"
      value={b.layout}
      options={LAYOUT_OPTIONS}
      disabled={!props.canWrite}
      onChange={v => b.saveConfig({ layout: v })}
    />
  )
}

export function LimitField({
  props,
  label = 'How many to show',
  hint,
}: {
  props: EditorProps
  label?: string
  hint?: string
}) {
  const b = useSectionBinding(props)
  return (
    <NumberField
      label={label}
      value={b.limit}
      disabled={!props.canWrite}
      hint={hint}
      onCommit={v => b.saveConfig({ limit: v })}
    />
  )
}

const VISITOR_OPTIONS = [
  { value: 'hide', label: 'Nothing' },
  { value: 'signin', label: 'A sign-in prompt' },
]

/** Business sections: what a signed-out visitor sees in the section's place. */
export function VisitorField({ props }: { props: EditorProps }) {
  const b = useSectionBinding(props)
  return (
    <Select
      label="Signed-out visitors see"
      value={businessVisitorView(props.section)}
      options={VISITOR_OPTIONS}
      disabled={!props.canWrite}
      hint="The section needs a business account. A sign-in prompt asks visitors to sign in to their business account."
      onChange={v => b.saveConfig({ visitor: v })}
    />
  )
}

const ASPECT_LABELS: Record<string, string> = {
  auto: 'Default',
  '21:9': '21:9 (ultra wide)',
  '16:9': '16:9 (wide)',
  '3:1': '3:1 (strip)',
  '5:3': '5:3',
  '4:3': '4:3',
  '1:1': '1:1 (square)',
  '4:5': '4:5 (portrait)',
  '3:4': '3:4 (tall)',
}

/** Shape of the section's cards or banner on this layout; only for types that declare one. */
export function AspectField({ props }: { props: EditorProps }) {
  const b = useSectionBinding(props)
  const target = SECTION_META[props.section.type].aspect
  if (!target) return null
  return (
    <Select
      label={`${target} shape`}
      value={sectionAspectValue(props.section)}
      options={SECTION_ASPECTS.map(a => ({ value: a, label: ASPECT_LABELS[a] ?? a }))}
      disabled={!props.canWrite}
      hint="Default keeps the built-in look. Set it per layout, so desktop, phone browsers and the app can differ."
      onChange={v => b.saveConfig({ aspect: v === 'auto' ? null : v })}
    />
  )
}

/** Where a listing-page section sits between the products. */
export function PlacementFields({ props }: { props: EditorProps }) {
  const b = useSectionBinding(props)
  const p = sectionPlacement(props.section)
  const save = (next: { after: number; every: number | null }) =>
    b.saveConfig({ placement: next.every ? next : { after: next.after } })
  return (
    <Grid>
      <NumberField
        label="Show after this many products"
        value={p.after}
        min={0}
        disabled={!props.canWrite}
        hint="0 puts it above the first product. It moves to the end of that row so the grid has no gaps."
        onCommit={after => save({ ...p, after })}
      />
      <NumberField
        label="Repeat every"
        value={p.every ?? 0}
        min={0}
        disabled={!props.canWrite}
        hint={`0 shows it once. Otherwise at least ${PLACEMENT_MIN_EVERY} products apart, up to 12 times.`}
        onCommit={every => save({ ...p, every: every === 0 ? null : Math.max(PLACEMENT_MIN_EVERY, every) })}
      />
    </Grid>
  )
}
