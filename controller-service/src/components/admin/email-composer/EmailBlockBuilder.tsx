'use client'

import { createContext, useCallback, useContext, useState } from 'react'
import ImageUrlInput from '@/components/admin/ImageUrlInput'
import AIEnrichButton from '@/components/admin/AIEnrichButton'
import AiMediaButton from '@/components/admin/ai/AiMediaButton'
import ScenarioFillDialog from '@/components/admin/messaging-templates/ScenarioFillDialog'
import { AI_SIZE_PRESETS } from '@/lib/ai/media-features'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Trash2, Plus, Image as ImageIcon, Type, Heading, MousePointerClick, Minus, Space, Package, LayoutGrid, Sparkles } from 'lucide-react'
import EmailComposer from '@/components/admin/email-composer/EmailComposer'
import AdminSelect from '@/components/admin/AdminSelect'
import { CAMPAIGN_VARIABLES } from '@/components/admin/email-composer/campaign-variables'
import type { ComposerVariable } from '@/components/admin/email-composer/variables'
import { renderBlocks, type EmailBlock } from '@/lib/templates/blocks'
import type { EditorFieldSnapshot, UndoHandle } from '@/lib/ai/scenario-fill-apply'
import type {
  TemplateMode,
  TemplateScenarioFill,
  TenantContext as ScenarioTenantContext,
} from '@/lib/ai/template-scenario.schema'

interface ScenarioFillConfig {
  /** Store context the AI uses to pick tone and defaults. */
  tenantContext: ScenarioTenantContext
  /** Platform-library blocks bill the platform tenant at internal pricing; store blocks bill the
   *  caller tenant at tenant pricing. Defaults to false (tenant-owned). */
  isPlatformLibrary?: boolean
  /** Marketing / utility / … — defaults to marketing for block-built emails. */
  templateMode?: TemplateMode
  /** Hide the opener on an existing/edited template (default true — show for new only). The
   *  per-block sparkles stay available in either case. */
  isNewTemplate?: boolean
  /** Pass 'ecom' when the email composer is mounted inside the ecom dashboard so the dialog
   *  renders in the ecom portal theme (pill buttons, ecom-accent-bg). Defaults to 'admin'. */
  theme?: 'admin' | 'ecom'
  /** Scenario-fill API route — admin by default; the ecom console passes its own
   *  (ownerApi + hasService gate). */
  apiEndpoint?: string
}

interface Props {
  blocks: EmailBlock[]
  onChange: (blocks: EmailBlock[]) => void
  extraVariables?: ComposerVariable[]
  /** When provided, renders a "Fill from scenario" header CTA that drafts the whole block tree.
   *  Omit (the default) when a parent editor — e.g. TemplateEditor — already owns that dialog.
   *  Set `isNewTemplate` to false to suppress the opener on an existing template (per-block
   *  sparkles still work). */
  scenarioFill?: ScenarioFillConfig
}

const VarsCtx = createContext<ComposerVariable[]>(CAMPAIGN_VARIABLES)

type BlockType = EmailBlock['type']

const PALETTE: { type: BlockType; label: string; icon: React.ReactNode; make: () => EmailBlock }[] = [
  { type: 'heading', label: 'Heading', icon: <Heading className="w-4 h-4" />, make: () => ({ type: 'heading', text: 'Your heading', align: 'left' }) },
  { type: 'text', label: 'Text', icon: <Type className="w-4 h-4" />, make: () => ({ type: 'text', html: '<p>Write something…</p>' }) },
  { type: 'hero_image', label: 'Hero image', icon: <ImageIcon className="w-4 h-4" />, make: () => ({ type: 'hero_image', url: '', alt: '' }) },
  { type: 'image', label: 'Image', icon: <ImageIcon className="w-4 h-4" />, make: () => ({ type: 'image', url: '', alt: '', width: 560 }) },
  { type: 'cta_button', label: 'Button', icon: <MousePointerClick className="w-4 h-4" />, make: () => ({ type: 'cta_button', text: 'Shop now', url: '{ctaUrl}' }) },
  { type: 'product_rows', label: 'Product rows', icon: <Package className="w-4 h-4" />, make: () => ({ type: 'product_rows' }) },
  { type: 'product_card', label: 'Product card', icon: <LayoutGrid className="w-4 h-4" />, make: () => ({ type: 'product_card' }) },
  { type: 'divider', label: 'Divider', icon: <Minus className="w-4 h-4" />, make: () => ({ type: 'divider' }) },
  { type: 'spacer', label: 'Spacer', icon: <Space className="w-4 h-4" />, make: () => ({ type: 'spacer', size: 'md' }) },
]

const inputCls =
  'w-full field-normal border border-border-secondary bg-surface text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent-500'

function BlockRow({
  id,
  block,
  onPatch,
  onRemove,
}: {
  id: string
  block: EmailBlock
  onPatch: (b: EmailBlock) => void
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }

  const vars = useContext(VarsCtx)
  const varNames = (vars ?? []).map(v => v.key)
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="rounded-lg border border-border-default bg-surface-elevated p-3"
    >
      <div className="flex items-center gap-2 mb-2">
        <button
          type="button"
          className="cursor-grab text-foreground-muted hover:text-foreground touch-none"
          aria-label="Drag to reorder"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="w-4 h-4" />
        </button>
        <span className="text-xs font-semibold uppercase tracking-wide text-foreground-muted flex-1">
          {PALETTE.find(p => p.type === block.type)?.label ?? block.type}
        </span>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove block"
          className="text-foreground-muted hover:text-red-500"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {block.type === 'heading' && (
        <div className="flex gap-2">
          <div className="relative flex-1 min-w-0">
            <input
              className={`${inputCls} pr-10`}
              value={block.text}
              onChange={e => onPatch({ ...block, text: e.target.value })}
              placeholder="Heading text ({variables} allowed)"
            />
            <AIEnrichButton placement="in-field" anchorClassName="absolute right-2 top-1/2 -translate-y-1/2" fieldLabel="Email heading" value={block.text} onChange={text => onPatch({ ...block, text })} scope="mailer:write" format="plain" maxLength={90} variables={varNames} write context="A heading inside a marketing email block." />
          </div>
          <div className="w-32 shrink-0">
            <AdminSelect
              value={block.align ?? 'left'}
              onChange={v => onPatch({ ...block, align: v as 'left' | 'center' })}
              options={[
                { value: 'left', label: 'Left' },
                { value: 'center', label: 'Center' },
              ]}
            />
          </div>
        </div>
      )}

      {block.type === 'text' && (
        <div className="relative">
          <EmailComposer
            value={block.html}
            onChange={html => onPatch({ ...block, html })}
            extraVariables={vars}
            minHeight={120}
            allowSource={false}
          />
          <AIEnrichButton placement="in-field" anchorClassName="absolute right-3 bottom-3 z-10" fieldLabel="Email text block (HTML)" value={block.html} onChange={html => onPatch({ ...block, html })} scope="mailer:write" format="html" variables={varNames} write context="A paragraph block inside a marketing email; no buttons or images." />
        </div>
      )}

      {(block.type === 'hero_image' || block.type === 'image') && (
        <div className="space-y-2">
          <div className="flex items-center justify-end">
            <AiMediaButton
              feature="email_hero"
              compact
              sizes={[AI_SIZE_PRESETS.landscape, AI_SIZE_PRESETS.square]}
              defaultPrompt={block.alt || 'Marketing hero image for an email campaign'}
              onPick={img => onPatch({ ...block, url: img.url })}
            />
          </div>
          <ImageUrlInput className={inputCls} value={block.url} onChange={url => onPatch({ ...block, url })} placeholder="Image URL (https://…) or upload" preview={false} />
          <input
            className={inputCls}
            value={block.alt ?? ''}
            onChange={e => onPatch({ ...block, alt: e.target.value })}
            placeholder="Alt text"
          />
          <input
            className={inputCls}
            value={block.href ?? ''}
            onChange={e => onPatch({ ...block, href: e.target.value })}
            placeholder="Link URL (optional, {ctaUrl} allowed)"
          />
          {block.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={block.url} alt="" className="max-h-28 rounded border border-border-default" />
          ) : null}
        </div>
      )}

      {block.type === 'cta_button' && (
        <div className="flex gap-2">
          <div className="relative flex-1 min-w-0">
            <input
              className={`${inputCls} pr-10`}
              value={block.text}
              onChange={e => onPatch({ ...block, text: e.target.value })}
              placeholder="Button text"
            />
            <AIEnrichButton placement="in-field" anchorClassName="absolute right-2 top-1/2 -translate-y-1/2" fieldLabel="Button text" value={block.text} onChange={text => onPatch({ ...block, text })} scope="mailer:write" format="label" maxLength={30} write context="Call-to-action button in a marketing email." />
          </div>
          <input
            className={inputCls}
            value={block.url}
            onChange={e => onPatch({ ...block, url: e.target.value })}
            placeholder="Button URL ({ctaUrl})"
          />
        </div>
      )}

      {block.type === 'spacer' && (
        <div className="w-32">
          <AdminSelect
            value={block.size ?? 'md'}
            onChange={v => onPatch({ ...block, size: v as 'sm' | 'md' | 'lg' })}
            options={[
              { value: 'sm', label: 'Small' },
              { value: 'md', label: 'Medium' },
              { value: 'lg', label: 'Large' },
            ]}
          />
        </div>
      )}

      {block.type === 'divider' && <p className="text-xs text-foreground-muted">A horizontal rule.</p>}
      {block.type === 'product_rows' && (
        <p className="text-xs text-foreground-muted">
          Renders the campaign&apos;s product rows ({'{itemsHtml}'}) at send time.
        </p>
      )}
      {block.type === 'product_card' && (
        <p className="text-xs text-foreground-muted">
          Renders the single featured product card ({'{productCard}'}) at send time.
        </p>
      )}
    </div>
  )
}

export default function EmailBlockBuilder({ blocks, onChange, extraVariables, scenarioFill }: Props) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  // Stable keys by index are fine here — blocks have no ids; we reorder the array directly.
  const ids = blocks.map((_, i) => `block-${i}`)

  const addBlock = useCallback(
    (type: BlockType) => {
      const make = PALETTE.find(p => p.type === type)!.make
      onChange([...blocks, make()])
    },
    [blocks, onChange]
  )

  const patchAt = (i: number, b: EmailBlock) => onChange(blocks.map((x, idx) => (idx === i ? b : x)))
  const removeAt = (i: number) => onChange(blocks.filter((_, idx) => idx !== i))

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    onChange(arrayMove(blocks, from, to))
  }

  // Scenario fill rewrites the whole block tree into a single text block holding the AI's HTML.
  // Blocks mode can't represent arbitrary rich HTML round-trip; the caller typically pairs this
  // dialog with a mode switch to Tiptap when they need the full HTML surface.
  const [scenarioOpen, setScenarioOpen] = useState(false)
  const scenarioSnapshot = (): EditorFieldSnapshot => ({
    name: '',
    body: renderBlocks(blocks),
    placeholders: [],
    buttons: [],
  })
  const applyScenarioFill = async (payload: TemplateScenarioFill): Promise<UndoHandle> => {
    const prev = blocks
    const next: EmailBlock[] = [{ type: 'text', html: payload.body }]
    onChange(next)
    return { sessionId: null, undo: () => onChange(prev) }
  }

  return (
    <VarsCtx.Provider value={extraVariables ?? CAMPAIGN_VARIABLES}>
    <div className="space-y-3">
      {scenarioFill && scenarioFill.isNewTemplate !== false && (
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setScenarioOpen(true)}
            className="inline-flex h-control shrink-0 items-center gap-1.5 rounded-lg border border-border-secondary bg-surface px-3 text-sm font-semibold text-foreground hover:bg-surface-secondary"
          >
            <Sparkles className="h-3.5 w-3.5 text-accent-500" aria-hidden />
            <span className="whitespace-nowrap">Fill from scenario</span>
          </button>
          <span className="min-w-0 text-[11px] text-foreground-muted">
            Describe the message once — the AI drafts the whole email for you.
          </span>
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {PALETTE.map(p => (
          <button
            key={p.type}
            type="button"
            onClick={() => addBlock(p.type)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border-default bg-surface text-xs font-medium text-foreground hover:bg-foreground/5"
          >
            <Plus className="w-3 h-3" /> {p.icon} {p.label}
          </button>
        ))}
      </div>

      {blocks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-default p-6 text-center text-sm text-foreground-muted">
          Add blocks above to build your email. Blocks render top-to-bottom inside the selected layout.
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {blocks.map((b, i) => (
                <BlockRow
                  key={ids[i]}
                  id={ids[i]}
                  block={b}
                  onPatch={nb => patchAt(i, nb)}
                  onRemove={() => removeAt(i)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
    {scenarioFill && (
      <ScenarioFillDialog
        open={scenarioOpen}
        onClose={() => setScenarioOpen(false)}
        channel="email"
        templateMode={scenarioFill.templateMode ?? 'marketing'}
        tenantContext={scenarioFill.tenantContext}
        current={scenarioSnapshot()}
        isPlatformLibrary={scenarioFill.isPlatformLibrary ?? false}
        applyFill={applyScenarioFill}
        theme={scenarioFill.theme ?? 'admin'}
        apiEndpoint={scenarioFill.apiEndpoint}
      />
    )}
    </VarsCtx.Provider>
  )
}
