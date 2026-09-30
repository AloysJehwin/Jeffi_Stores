'use client'

import { useState } from 'react'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ChevronDown, GripVertical, Plus, Trash2 } from 'lucide-react'
import Toggle from '@/components/ui/Toggle'
import { useToast } from '@/contexts/ToastContext'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { SECTION_META, SECTION_TYPES, type HomepageSection, type SectionType } from '@/lib/homepage-sections'
import SectionConfigFields from './SectionConfigFields'
import SectionPreview from './SectionPreview'
import OfferSliderControl from './OfferSliderControl'
import { notifyHomepageDraftChanged } from './draft-events'
import type { SectionOptions } from './editors/fields'

/** Persist a partial config merge onto a section, updating local state and the API. */
export type SaveSectionConfig = (config: Record<string, unknown>) => void

interface Props {
  initial: HomepageSection[]
  options?: SectionOptions
  /** Rendered inside the expanded `hero` row — the slide editor lives there. */
  heroEditor?: React.ReactNode
  /** Render every section's editor open and non-collapsible (dedicated Homepage page). */
  alwaysExpanded?: boolean
}

export default function HomepageSectionManager({ initial, options, heroEditor, alwaysExpanded = false }: Props) {
  const { showToast, showConfirm } = useToast()
  const canWrite = useCanWrite('settings:write')
  const [sections, setSections] = useState(initial)
  const [picking, setPicking] = useState(false)
  const [addedId, setAddedId] = useState<string | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const usedSingletons = new Set(sections.filter(s => SECTION_META[s.type]?.singleton).map(s => s.type))

  async function patch(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/admin/homepage-sections/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    })
    showToast(res.ok ? 'Saved to draft' : 'Failed to save', res.ok ? 'success' : 'error')
    if (res.ok) notifyHomepageDraftChanged()
  }

  function update(id: string, patchObj: Partial<HomepageSection>) {
    setSections(prev => prev.map(s => (s.id === id ? { ...s, ...patchObj } : s)))
  }

  function saveConfigFor(section: HomepageSection, config: Record<string, unknown>) {
    const next = { ...(section.config ?? {}), ...config }
    update(section.id, { config: next })
    patch(section.id, { config: next })
  }

  async function addSection(type: SectionType) {
    setPicking(false)
    const res = await fetch('/api/admin/homepage-sections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ type }),
    })
    if (!res.ok) {
      showToast('Failed to add section', 'error')
      return
    }
    const { section } = await res.json()
    setAddedId(section.id)
    setSections(prev => [...prev, section])
    showToast('Section added to draft', 'success')
    notifyHomepageDraftChanged()
  }

  async function removeSection(section: HomepageSection) {
    const ok = await showConfirm({
      title: 'Remove section?',
      message: `"${section.title || SECTION_META[section.type].label}" will be removed from the draft. It stays live until you publish.`,
    })
    if (!ok) return
    const res = await fetch(`/api/admin/homepage-sections/${section.id}`, { method: 'DELETE', credentials: 'include' })
    if (!res.ok) {
      showToast('Failed to remove', 'error')
      return
    }
    setSections(prev => prev.filter(s => s.id !== section.id))
    showToast('Section removed from draft', 'success')
    notifyHomepageDraftChanged()
  }

  async function onDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = sections.findIndex(s => s.id === active.id)
    const to = sections.findIndex(s => s.id === over.id)
    if (from < 0 || to < 0) return

    const previous = sections
    const reordered = arrayMove(sections, from, to)
    setSections(reordered)
    const res = await fetch('/api/admin/homepage-sections', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ order: reordered.map(s => s.id) }),
    })
    if (!res.ok) {
      setSections(previous)
      showToast('Failed to reorder', 'error')
      return
    }
    notifyHomepageDraftChanged()
  }

  return (
    <div className="space-y-4">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={sections.map(s => s.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {sections.map((section, i) => (
              <SectionRow
                key={section.id}
                section={section}
                position={i + 1}
                canWrite={canWrite}
                options={options}
                onChange={update}
                onSave={patch}
                onRemove={removeSection}
                alwaysExpanded={alwaysExpanded}
                defaultOpen={section.id === addedId}
                extra={
                  section.type === 'hero' ? (
                    heroEditor
                  ) : section.type === 'offer_slider' ? (
                    <OfferSliderControl section={section} saveConfig={config => saveConfigFor(section, config)} />
                  ) : undefined
                }
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {sections.length === 0 && (
        <p className="text-xs text-foreground-muted">
          No sections configured — the homepage is using its built-in default layout.
        </p>
      )}

      {canWrite && (
        <div>
          <button
            type="button"
            onClick={() => setPicking(p => !p)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-border-secondary text-foreground hover:bg-surface-secondary"
          >
            <Plus className="w-4 h-4" /> Add section
          </button>

          {picking && (
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
              {SECTION_TYPES.map(type => {
                const meta = SECTION_META[type]
                const taken = meta.singleton && usedSingletons.has(type)
                return (
                  <button
                    key={type}
                    type="button"
                    disabled={taken}
                    onClick={() => addSection(type)}
                    className="text-left p-3 rounded-lg border border-border-default hover:border-accent-400 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <span className="block text-sm font-medium text-foreground">{meta.label}</span>
                    <span className="block text-xs text-foreground-muted mt-0.5">
                      {taken ? 'Already on the page' : meta.description}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface RowProps {
  section: HomepageSection
  position: number
  canWrite: boolean
  options?: SectionOptions
  onChange: (id: string, patch: Partial<HomepageSection>) => void
  onSave: (id: string, body: Record<string, unknown>) => Promise<void>
  onRemove: (section: HomepageSection) => void
  extra?: React.ReactNode
  alwaysExpanded?: boolean
  /** Open on mount, e.g. a section the admin just added. */
  defaultOpen?: boolean
}

function SectionRow({
  section,
  position,
  canWrite,
  options,
  onChange,
  onSave,
  onRemove,
  extra,
  alwaysExpanded = false,
  defaultOpen = false,
}: RowProps) {
  const [expanded, setExpanded] = useState(alwaysExpanded || defaultOpen)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: section.id })
  const meta = SECTION_META[section.type]
  const open = alwaysExpanded || expanded

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`rounded-lg border border-border-default bg-surface ${isDragging ? 'opacity-60' : ''}`}
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        {/* Listeners stay on the grip: on the row they would swallow clicks on the toggle
            and every input inside the expanded editor. */}
        <button
          type="button"
          className="cursor-grab active:cursor-grabbing text-foreground-muted disabled:opacity-40"
          disabled={!canWrite}
          aria-label={`Reorder ${meta.label}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="w-4 h-4" />
        </button>

        <span className="w-5 text-xs tabular-nums text-foreground-muted shrink-0">{position}</span>

        {alwaysExpanded ? (
          <div className="flex-1 flex items-center gap-2 min-w-0">
            <span className="text-sm font-medium text-foreground truncate">{section.title || meta.label}</span>
            <span className="text-xs text-foreground-muted shrink-0 hidden sm:inline">{meta.label}</span>
            {!section.is_active && (
              <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-surface-secondary text-foreground-muted shrink-0">
                Hidden
              </span>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            aria-expanded={expanded}
            className="flex-1 flex items-center gap-2 text-left min-w-0"
          >
            <span className="text-sm font-medium text-foreground truncate">{section.title || meta.label}</span>
            <span className="text-xs text-foreground-muted shrink-0 hidden sm:inline">{meta.label}</span>
            {!section.is_active && (
              <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-surface-secondary text-foreground-muted shrink-0">
                Hidden
              </span>
            )}
            <ChevronDown
              className={`w-4 h-4 ml-auto shrink-0 text-foreground-muted transition-transform ${expanded ? 'rotate-180' : ''}`}
            />
          </button>
        )}

        <Toggle
          checked={section.is_active}
          disabled={!canWrite}
          onChange={next => {
            onChange(section.id, { is_active: next })
            onSave(section.id, { isActive: next })
          }}
        />
      </div>

      <div className={open ? 'px-3 pb-3 pt-1 space-y-3 border-t border-border-default' : 'hidden'}>
        {open && <SectionPreview section={section} />}
        {extra}
        <SectionConfigFields
          section={section}
          canWrite={canWrite}
          options={options}
          onChange={onChange}
          onSave={onSave}
        />
        {canWrite && (
          <button
            type="button"
            onClick={() => onRemove(section)}
            className="inline-flex items-center gap-1.5 text-xs text-red-600 hover:text-red-700"
          >
            <Trash2 className="w-3.5 h-3.5" /> Remove section
          </button>
        )}
      </div>
    </div>
  )
}
