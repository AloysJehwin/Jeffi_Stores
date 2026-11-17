'use client'

import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import type { Block, PageRef } from '@jeffi/site-blocks'
import SectionConfigFields from '@/components/admin/homepage/SectionConfigFields'
import { DateTimeField, INPUT_CLASS, LABEL_CLASS, type SectionOptions } from '@/components/admin/homepage/editors/fields'
import type { HomepageAudience, HomepagePage, HomepageSection, HomepageSurface } from '@/lib/catalog/homepage-sections'
import { isSectionBlock, siteRegistry } from '@/lib/site/blocks'
import BlockFields from './BlockFields'
import CodeSectionPanel from './CodeSectionPanel'
import ComposedEditor from './ComposedEditor'

// The selected block's settings. Section blocks reuse the homepage section editors through an adapter (a block reads as
// a section row, and an edit to the row writes back to the block); the hero's slides get their own list.

type Props = Record<string, unknown>
type SectionPatch = Partial<HomepageSection>

export function blockAsSection(b: Block, ref: Pick<PageRef, 'audience' | 'surface' | 'page'>): HomepageSection {
  const p = b.props as Props
  return {
    id: b.id,
    type: b.type as HomepageSection['type'],
    title: (p.title as string | null) ?? null,
    subtitle: (p.subtitle as string | null) ?? null,
    eyebrow: (p.eyebrow as string | null) ?? null,
    cta_label: (p.ctaLabel as string | null) ?? null,
    cta_url: (p.ctaUrl as string | null) ?? null,
    config: (p.config as Record<string, unknown>) ?? {},
    display_order: 0,
    is_active: !b.visibility?.hidden,
    starts_at: b.visibility?.from ?? null,
    ends_at: b.visibility?.to ?? null,
    surface: ref.surface as HomepageSurface,
    page: ref.page as HomepagePage,
    audience: ref.audience as HomepageAudience,
  }
}

/** A section-row edit as the block it came from. */
export function applySectionPatch(b: Block, patch: SectionPatch): Block {
  const props: Props = { ...b.props }
  const vis = { ...(b.visibility ?? {}) }
  if ('title' in patch) props.title = patch.title ?? null
  if ('subtitle' in patch) props.subtitle = patch.subtitle ?? null
  if ('eyebrow' in patch) props.eyebrow = patch.eyebrow ?? null
  if ('cta_label' in patch) props.ctaLabel = patch.cta_label ?? null
  if ('cta_url' in patch) props.ctaUrl = patch.cta_url ?? null
  if ('config' in patch) props.config = patch.config ?? {}
  if ('is_active' in patch) vis.hidden = patch.is_active === false
  if ('starts_at' in patch) vis.from = patch.starts_at ?? null
  if ('ends_at' in patch) vis.to = patch.ends_at ?? null
  const visibility = vis.hidden || vis.from || vis.to ? vis : undefined
  return { ...b, props, visibility }
}

export default function BlockInspector({
  block,
  pageRef,
  options,
  canWrite,
  onChange,
  onTemplatesChanged,
  pointed,
}: {
  block: Block
  pageRef: Pick<PageRef, 'audience' | 'surface' | 'page'>
  options: SectionOptions
  canWrite: boolean
  onChange: (next: Block) => void
  onTemplatesChanged?: () => void
  /** What the owner pointed at in the preview (code sections pass it to the AI). */
  pointed?: string | null
}) {
  const def = siteRegistry.get(block.type)
  const section = blockAsSection(block, pageRef)
  const patch = (p: SectionPatch) => onChange(applySectionPatch(block, p))

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold text-foreground">{def?.label ?? block.type}</p>
        {def?.description && <p className="text-xs text-foreground-muted mt-0.5">{def.description}</p>}
      </div>

      <div className="rounded-lg border border-border-default p-3 space-y-3">
        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="text-foreground">Shown on this layout</span>
          <input type="checkbox" checked={section.is_active} disabled={!canWrite} onChange={e => patch({ is_active: e.target.checked })} />
        </label>
        <div className="grid grid-cols-1 gap-2">
          <DateTimeField label="Show from" value={section.starts_at} disabled={!canWrite} placeholder="Right away" onCommit={v => patch({ starts_at: v })} />
          <DateTimeField label="Until" value={section.ends_at} disabled={!canWrite} placeholder="No end" onCommit={v => patch({ ends_at: v })} />
        </div>
      </div>

      {block.type === 'hero' && <HeroSlidesField block={block} canWrite={canWrite} onChange={onChange} />}

      {!isSectionBlock(block.type) && <BlockFields block={block} canWrite={canWrite} onChange={onChange} />}

      {block.type === 'composed' && <ComposedEditor block={block} pageRef={pageRef} onChange={onChange} onSaved={onTemplatesChanged} />}

      {block.type === 'code_section' && <CodeSectionPanel block={block} pageRef={pageRef} pointed={pointed} onChange={onChange} />}

      {isSectionBlock(block.type) && (
        <fieldset disabled={!canWrite} className="min-w-0">
          <SectionConfigFields
            section={section}
            canWrite={canWrite}
            options={options}
            onChange={(_id, p) => patch(p)}
            onSave={async () => {}}
          />
        </fieldset>
      )}
    </div>
  )
}

type Slide = Record<string, unknown> & { id: string }
const SLIDE_FIELDS: { key: string; label: string; placeholder?: string }[] = [
  { key: 'title', label: 'Title' },
  { key: 'subtitle', label: 'Subtitle' },
  { key: 'badge_text', label: 'Badge' },
  { key: 'image_url', label: 'Image URL (desktop)', placeholder: 'https://' },
  { key: 'image_url_mobile', label: 'Image URL (phones)', placeholder: 'Optional' },
  { key: 'cta_label', label: 'Button label' },
  { key: 'cta_url', label: 'Button link', placeholder: '/products' },
]

/** The hero's slides on this layout: edit, reorder, add and remove. */
function HeroSlidesField({ block, canWrite, onChange }: { block: Block; canWrite: boolean; onChange: (b: Block) => void }) {
  const slides = (Array.isArray((block.props as Props).slides) ? (block.props as Props).slides : []) as Slide[]
  const set = (next: Slide[]) => onChange({ ...block, props: { ...block.props, slides: next } })
  const move = (i: number, d: number) => {
    const next = [...slides]
    const [s] = next.splice(i, 1)
    next.splice(i + d, 0, s)
    set(next)
  }
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-foreground">Slides on this layout</p>
      {slides.map((s, i) => (
        <details key={s.id} className="rounded-lg border border-border-default">
          <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer text-sm">
            <span className="flex-1 truncate">{String(s.title || `Slide ${i + 1}`)}</span>
            {s.is_active === false && <span className="text-[10px] uppercase text-foreground-muted">Hidden</span>}
          </summary>
          <div className="px-3 pb-3 space-y-2">
            {SLIDE_FIELDS.map(f => (
              <label key={f.key} className="block">
                <span className={LABEL_CLASS}>{f.label}</span>
                <input
                  className={INPUT_CLASS}
                  disabled={!canWrite}
                  placeholder={f.placeholder}
                  value={String(s[f.key] ?? '')}
                  onChange={e => set(slides.map(x => (x.id === s.id ? { ...x, [f.key]: e.target.value || null } : x)))}
                />
              </label>
            ))}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" disabled={!canWrite} checked={s.is_active !== false} onChange={e => set(slides.map(x => (x.id === s.id ? { ...x, is_active: e.target.checked } : x)))} />
              Shown
            </label>
            {canWrite && (
              <div className="flex gap-1">
                <button type="button" className="p-1.5 rounded border border-border-default disabled:opacity-40" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                <button type="button" className="p-1.5 rounded border border-border-default disabled:opacity-40" disabled={i === slides.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>
                <button type="button" className="ml-auto inline-flex items-center gap-1 text-xs text-red-600" onClick={() => set(slides.filter(x => x.id !== s.id))}>
                  <Trash2 className="w-3.5 h-3.5" /> Remove
                </button>
              </div>
            )}
          </div>
        </details>
      ))}
      {canWrite && (
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-accent-600"
          onClick={() => set([...slides, { id: crypto.randomUUID(), title: 'New slide', is_active: true, filter_in_stock: false, filter_on_sale: false }])}
        >
          <Plus className="w-3.5 h-3.5" /> Add slide
        </button>
      )}
    </div>
  )
}
