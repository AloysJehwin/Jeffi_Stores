'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { FONT_CHOICES, STYLE_CHOICES, emptyDoc, isPageKey, normalizeTheme, type Block, type BlockCategory, type PageDoc, type PageRef, type SiteTemplate, type ThemeStyle, type ThemeTokens } from '@jeffi/site-blocks'
import { INPUT_CLASS, Select } from '@/components/admin/homepage/editors/fields'
import { isSectionBlock, siteRegistry } from '@/lib/site/blocks'
import { THEME_PACK_PREFIX, THEME_PALETTES, THEME_STYLES, themeIdOf, themeName, themeStyle, themeTokens, type ThemeAvailable, type ThemePalette, type ThemeStyleId } from '@/lib/site/themes/catalog'
import { useLibraryDrag, type NewItem } from './BlockList'
import AdminThemeToggle from './AdminThemeToggle'
import { PanelSkeleton, WorkCard } from './SiteBuilderLoading'

const CATEGORY: Record<BlockCategory, string> = {
  structure: 'Layout',
  content: 'Content',
  commerce: 'Products and offers',
  interactive: 'Interactive',
  page: 'Page',
  business: 'Business',
}

/** A library entry: a click adds it after the selected block; with `draggable`, it also drags into the block list. */
function Entry({ item, draggable, disabled, onClick, className, children }: { item: NewItem; draggable: boolean; disabled: boolean; onClick: () => void; className: string; children: ReactNode }) {
  const drag = useLibraryDrag(item, disabled || !draggable)
  // A drag dropped back on the entry is not a click.
  const endedAt = useRef(0)
  useEffect(() => {
    if (!drag.isDragging) endedAt.current = Date.now()
  }, [drag.isDragging])
  return (
    <button
      ref={drag.ref}
      type="button"
      disabled={disabled}
      onClick={() => Date.now() - endedAt.current > 300 && onClick()}
      onPointerDown={drag.onPointerDown}
      className={`${className} ${draggable && !disabled ? 'cursor-grab touch-none' : ''} ${drag.isDragging ? 'opacity-50' : ''}`}
      title={draggable && !disabled ? 'Click to add after the selected block, or drag it into the list' : undefined}
    >
      {children}
    </button>
  )
}

/** Blocks this page can have, grouped; a singleton already on the page or a type outside the plan is disabled. */
export function BlockLibrary({
  pageRef,
  doc,
  planTypes,
  onAdd,
  saved = [],
  onAddSaved,
  onDeleteSaved,
  draggable = false,
}: {
  pageRef: Pick<PageRef, 'audience' | 'surface' | 'page'>
  doc: PageDoc
  planTypes: string[] | null
  onAdd: (type: string) => void
  /** Blocks the owner saved ("My blocks"); offered where their type may go. */
  saved?: SiteTemplate[]
  onAddSaved?: (block: Block) => void
  onDeleteSaved?: (t: SiteTemplate) => void
  /** Entries also drag into the editor's block list (inside its DndContext). */
  draggable?: boolean
}) {
  const [q, setQ] = useState('')
  const used = new Set(Object.values(doc.blocks).map(b => b.type))
  const match = (text: string) => !q || text.toLowerCase().includes(q.toLowerCase())
  // A custom block starts from the AI or from My blocks, not empty.
  const defs = siteRegistry
    .allowedOn(pageRef)
    .filter(d => d.type !== 'composed' && match(`${d.label} ${d.description ?? ''}`))
  const allowed = new Set(siteRegistry.allowedOn(pageRef).map(d => d.type))
  const mine = saved
    .filter(t => t.kind === 'block')
    .map(t => ({ t, block: Object.values(t.pages[0]?.doc.blocks ?? {})[0] as Block | undefined }))
    .filter((x): x is { t: SiteTemplate; block: Block } => !!x.block && allowed.has(x.block.type) && match(x.t.name))
  const groups = Object.entries(CATEGORY)
    .map(([cat, label]) => ({ label, defs: defs.filter(d => d.category === cat) }))
    .filter(g => g.defs.length)
  return (
    <div className="space-y-3">
      <input className={INPUT_CLASS} placeholder="Search blocks" value={q} onChange={e => setQ(e.target.value)} />
      {mine.length > 0 && onAddSaved && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">My blocks</p>
          {mine.map(({ t, block }) => (
            <div key={t.id} className="flex items-stretch gap-1">
              <Entry
                item={{ kind: 'new', type: block.type, label: t.name, saved: block }}
                draggable={draggable}
                disabled={false}
                onClick={() => onAddSaved(block)}
                className="flex-1 min-w-0 text-left rounded-lg border border-border-default px-3 py-2 hover:border-accent-500"
              >
                <span className="block text-sm font-medium text-foreground truncate">{t.name}</span>
                <span className="block text-xs text-foreground-muted">Saved custom block</span>
              </Entry>
              {onDeleteSaved && (
                <button type="button" onClick={() => onDeleteSaved(t)} className="px-2 rounded-lg border border-border-default text-xs text-foreground-muted hover:text-red-600" aria-label={`Delete ${t.name}`}>
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {groups.map(g => (
        <div key={g.label} className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">{g.label}</p>
          {g.defs.map(d => {
            const why = d.singleton && used.has(d.type) ? 'Already on the page' : planTypes && isSectionBlock(d.type) && !planTypes.includes(d.type) ? 'Not in your plan' : null
            return (
              <Entry
                key={d.type}
                item={{ kind: 'new', type: d.type, label: d.label }}
                draggable={draggable}
                disabled={!!why}
                onClick={() => onAdd(d.type)}
                className="w-full text-left rounded-lg border border-border-default px-3 py-2 hover:border-accent-500 disabled:opacity-50 disabled:hover:border-border-default"
              >
                <span className="block text-sm font-medium text-foreground">{d.label}</span>
                <span className="block text-xs text-foreground-muted line-clamp-2">{why ?? d.description}</span>
              </Entry>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// The style tokens; "As built" leaves the token unset, so those pages keep their own look.
const STYLE_FIELDS: [keyof ThemeStyle, string, Record<string, string>][] = [
  ['buttonShape', 'Button shape', { square: 'Square', rounded: 'Rounded (follows corners)', pill: 'Pill' }],
  ['cardStyle', 'Cards', { flat: 'Flat (tinted, no border)', outlined: 'Outlined', shadow: 'Shadow' }],
  ['inputStyle', 'Form fields', { outlined: 'Outlined', filled: 'Filled', underline: 'Underline' }],
  ['headingCase', 'Headings (heading font)', { normal: 'Normal case', upper: 'Capitals' }],
  ['headingTracking', 'Heading letter spacing', { tight: 'Tight', normal: 'Normal', wide: 'Wide' }],
  ['shadow', 'Shadows', { none: 'None', soft: 'Soft', strong: 'Strong' }],
]

const pick = <T extends string>(label: string, value: T, options: { value: T; label: string }[], onChange: (v: T) => void, disabled: boolean) => (
  <Select label={label} value={value} options={options} disabled={disabled} onChange={v => onChange(v as T)} />
)

/** The store's (or business portal's) colours, fonts and shape; saved into the draft, live on publish. */
export function ThemePanel({ theme, canWrite, onChange }: { theme: ThemeTokens; canWrite: boolean; onChange: (t: ThemeTokens) => void }) {
  const set = (patch: Partial<ThemeTokens>) => onChange(normalizeTheme({ ...theme, ...patch }))
  const fonts = FONT_CHOICES.map(f => ({ value: f.name, label: `${f.name} (${f.kind})` }))
  return (
    <div className="space-y-3">
      {(['primary', 'accent', 'neutral'] as const).map(k => (
        <label key={k} className="flex items-center justify-between gap-3">
          <span className="text-sm text-foreground capitalize">{k === 'neutral' ? 'Dark tone' : k === 'primary' ? 'Brand colour' : 'Accent colour'}</span>
          <span className="flex items-center gap-2">
            <code className="text-xs text-foreground-muted">{theme[k]}</code>
            <input type="color" disabled={!canWrite} value={theme[k]} onChange={e => set({ [k]: e.target.value })} className="h-8 w-10 rounded border border-border-default bg-transparent" />
          </span>
        </label>
      ))}
      {pick('Heading font', theme.fontDisplay, fonts, v => set({ fontDisplay: v }), !canWrite)}
      {pick('Body font', theme.fontBody, fonts, v => set({ fontBody: v }), !canWrite)}
      {pick('Corners', theme.radius, [{ value: 'none', label: 'Square' }, { value: 'sm', label: 'Slightly rounded' }, { value: 'md', label: 'Rounded' }, { value: 'lg', label: 'Very rounded' }, { value: 'full', label: 'Soft' }], v => set({ radius: v }), !canWrite)}
      {pick('Buttons', theme.buttonStyle, [{ value: 'solid', label: 'Solid' }, { value: 'outline', label: 'Outline' }, { value: 'pill', label: 'Pill' }], v => set({ buttonStyle: v }), !canWrite)}
      {pick('Spacing', theme.density, [{ value: 'compact', label: 'Compact' }, { value: 'comfortable', label: 'Comfortable' }, { value: 'airy', label: 'Airy' }], v => set({ density: v }), !canWrite)}
      <p className="pt-2 text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">Account, order, sign-in and policy pages</p>
      {STYLE_FIELDS.map(([key, label, names]) => (
        <Select
          key={key}
          label={label}
          value={theme[key] ?? 'auto'}
          options={[{ value: 'auto', label: 'As built' }, ...STYLE_CHOICES[key].map(v => ({ value: v, label: names[v] }))]}
          disabled={!canWrite}
          onChange={v => set({ [key]: v === 'auto' ? undefined : v } as Partial<ThemeStyle>)}
        />
      ))}
      <p className="text-xs text-foreground-muted">Applies to the storefront and the business storefront once published.</p>
      <AdminThemeToggle />
    </div>
  )
}

/** A ready-made theme as a site pack: the editor applies it by id (drafts/[id]/pack); its pages here only count them. */
const themePack = (style: ThemeStyleId, p: ThemePalette, keys: string[]): SiteTemplate => ({
  id: `${THEME_PACK_PREFIX}${themeIdOf(style, p.id)}`,
  name: themeName(style, p),
  description: themeStyle(style).blurb,
  kind: 'site',
  pages: keys.filter(isPageKey).map(page => ({ audience: 'store' as const, surface: 'web' as const, page, doc: emptyDoc() })),
  theme: themeTokens(style, p),
})

/** The ready-made themes (lib/site/themes): every page of a style in the palette picked, into the draft like a site pack. */
function ThemePacks({ themes, canWrite, onApplyPack }: { themes: ThemeAvailable; canWrite: boolean; onApplyPack: (t: SiteTemplate) => void }) {
  const styles = THEME_STYLES.filter(s => themes[s])
  if (!styles.length) return null
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">Ready-made themes</p>
      {styles.map(s => (
        <div key={s} className="rounded-lg border border-border-default p-3 space-y-2">
          <div>
            <p className="text-sm font-medium text-foreground">{themeStyle(s).name}</p>
            <p className="text-xs text-foreground-muted">
              {themeStyle(s).blurb} · {themes[s]!.pages} pages
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {THEME_PALETTES[s].map(p => (
              <button
                key={p.id}
                type="button"
                disabled={!canWrite}
                title={p.name}
                aria-label={`Apply ${themeName(s, p)} to the whole site`}
                onClick={() => onApplyPack(themePack(s, p, themes[s]!.keys))}
                className="rounded-full p-0.5 hover:ring-2 hover:ring-accent-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 disabled:opacity-50"
              >
                <span aria-hidden className="block h-6 w-6 rounded-full border border-border-default" style={{ background: `conic-gradient(${p.primary} 0 50%, ${p.accent} 50% 75%, ${p.neutral} 75% 100%)` }} />
              </button>
            ))}
          </div>
        </div>
      ))}
      <p className="text-[11px] text-foreground-muted">Pick a palette: its pages and colours go into this draft, to review and publish.</p>
    </div>
  )
}

/** Built-in and saved templates for this page, plus "save this page as my template". */
export function TemplatePanel({
  templates,
  pageRef,
  canWrite,
  onApply,
  onSave,
  onDelete,
  onApplyPack,
  hasApp = true,
  work = null,
}: {
  templates: { builtIn: SiteTemplate[]; saved: SiteTemplate[]; themes?: ThemeAvailable } | null
  pageRef: Pick<PageRef, 'audience' | 'surface' | 'page'>
  canWrite: boolean
  onApply: (t: SiteTemplate) => void
  onSave: (name: string) => void
  onDelete: (t: SiteTemplate) => void
  onApplyPack?: (t: SiteTemplate) => void
  /** The store has a mobile app; templates for the app layout are offered only then. */
  hasApp?: boolean
  /** A theme or pack is being applied: shown at the top while the controls wait. */
  work?: { title: string; step: string } | null
}) {
  const [name, setName] = useState('')
  const fits = (t: SiteTemplate) => t.kind === 'page' && t.pages.some(p => p.page === pageRef.page && (hasApp || p.surface !== 'app'))
  const packs = (templates?.builtIn ?? []).filter(t => t.kind === 'site' && t.pages.some(p => p.audience === pageRef.audience && (hasApp || p.surface !== 'app')))
  const list = useMemo(
    () => [...(templates?.saved ?? []).map(t => ({ t, saved: true })), ...(templates?.builtIn ?? []).map(t => ({ t, saved: false }))].filter(x => fits(x.t)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [templates, pageRef.page]
  )
  if (!templates) return <PanelSkeleton cards={4} label="Loading templates" />
  return (
    <div className="space-y-3">
      {work && <WorkCard {...work} />}
      {templates.themes && onApplyPack && pageRef.audience === 'store' && <ThemePacks themes={templates.themes} canWrite={canWrite && !work} onApplyPack={onApplyPack} />}
      {packs.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">Whole-site styles</p>
          {packs.map(t => (
            <div key={t.id} className="rounded-lg border border-border-default p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-foreground">{t.name}</p>
                <span className="flex gap-1" aria-hidden>
                  {[t.theme?.primary, t.theme?.accent, t.theme?.neutral].filter(Boolean).map((c, i) => (
                    <span key={i} className="h-4 w-4 rounded-full border border-border-default" style={{ background: c }} />
                  ))}
                </span>
              </div>
              <p className="text-xs text-foreground-muted">{t.description}</p>
              {t.theme?.fontDisplay && <p className="text-[11px] text-foreground-muted">Fonts: {t.theme.fontDisplay} / {t.theme.fontBody}</p>}
              {canWrite && onApplyPack && (
                <button type="button" disabled={!!work} className="text-xs font-medium text-accent-600 disabled:opacity-50" onClick={() => onApplyPack(t)}>
                  Apply to the whole site ({new Set(t.pages.map(p => p.page)).size} pages)
                </button>
              )}
            </div>
          ))}
          <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted pt-2">For this page</p>
        </div>
      )}
      {list.length === 0 && <p className="text-sm text-foreground-muted">No templates for this page yet.</p>}
      {list.map(({ t, saved }) => (
        <div key={t.id} className="rounded-lg border border-border-default p-3 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium text-foreground">{t.name}</p>
            <span className="text-[10px] uppercase tracking-wide text-foreground-muted">{saved ? 'Yours' : 'Built in'}</span>
          </div>
          {t.description && <p className="text-xs text-foreground-muted">{t.description}</p>}
          {canWrite && (
            <div className="flex gap-3">
              <button type="button" className="text-xs font-medium text-accent-600" onClick={() => onApply(t)}>
                Use on this layout
              </button>
              {saved && (
                <button type="button" className="text-xs text-red-600" onClick={() => onDelete(t)}>
                  Delete
                </button>
              )}
            </div>
          )}
        </div>
      ))}
      {canWrite && (
        <div className="rounded-lg border border-dashed border-border-secondary p-3 space-y-2">
          <p className="text-xs font-medium text-foreground">Save this layout as a template</p>
          <input className={INPUT_CLASS} placeholder="Template name" value={name} maxLength={120} onChange={e => setName(e.target.value)} />
          <button
            type="button"
            disabled={name.trim().length < 2}
            className="text-xs font-medium text-accent-600 disabled:opacity-50"
            onClick={() => {
              onSave(name.trim())
              setName('')
            }}
          >
            Save template
          </button>
        </div>
      )}
    </div>
  )
}
