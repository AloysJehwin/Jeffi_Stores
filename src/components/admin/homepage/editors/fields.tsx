'use client'

import { useEffect, useRef, useState } from 'react'
import AdminSelect from '@/components/admin/AdminSelect'
import DateTimePicker from '@/components/ui/DateTimePicker'
import Toggle from '@/components/ui/Toggle'
import {
  sectionLayout,
  sectionLimit,
  sectionCopyDefaults,
  type HomepageSection,
  type SectionCopy,
  type SectionType,
} from '@/lib/homepage-sections'

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

export function Text({
  label,
  value,
  disabled,
  hint,
  placeholder,
  onCommit,
}: {
  label: string
  value: string
  disabled: boolean
  hint?: string
  placeholder?: string
  onCommit: (v: string) => void
}) {
  const { draft, setDraft, focused } = useExternalValue(value)
  return (
    <div>
      <label className={LABEL_CLASS}>{label}</label>
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
        className={INPUT_CLASS}
      />
      {hint && <p className="text-[11px] text-foreground-muted mt-1">{hint}</p>}
    </div>
  )
}

export function TextArea({
  label,
  value,
  disabled,
  hint,
  rows = 3,
  onCommit,
}: {
  label: string
  value: string
  disabled: boolean
  hint?: string
  rows?: number
  onCommit: (v: string) => void
}) {
  const { draft, setDraft, focused } = useExternalValue(value)
  return (
    <div>
      <label className={LABEL_CLASS}>{label}</label>
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
        className={`${INPUT_CLASS} resize-none`}
      />
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
  const note = 'Live default. Edit to change it; clear it to restore the default.'
  return hint ? `${hint} ${note}` : note
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
        onCommit={b.eyebrow}
      />
      <Text
        label="Heading"
        value={section.title ?? d.title ?? ''}
        disabled={!canWrite}
        hint={copyHint(section.title == null && !!d.title)}
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
        onCommit={b.ctaLabel}
      />
      <Text
        label="Button link"
        value={section.cta_url ?? d.ctaUrl ?? ''}
        disabled={!canWrite}
        placeholder={urlPlaceholder}
        hint={copyHint(section.cta_url == null && !!d.ctaUrl, hint)}
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
