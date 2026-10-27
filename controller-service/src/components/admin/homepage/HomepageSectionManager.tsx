'use client'

import { useState } from 'react'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ChevronDown, Copy, GripVertical, Lock, Plus, Trash2 } from 'lucide-react'
import Toggle from '@/components/ui/Toggle'
import { useToast } from '@/contexts/ToastContext'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import {
  SECTION_META,
  rowAudience,
  sectionPlacement,
  sectionTypesFor,
  type HomepageAudience,
  type HomepagePage,
  type HomepageSection,
  type HomepageSurface,
  type SectionType,
} from '@/lib/catalog/homepage-sections'
import SectionConfigFields from './SectionConfigFields'
import SectionPreview from './SectionPreview'
import OfferSliderControl from './OfferSliderControl'
import { notifyHomepageDraftChanged } from './draft-events'
import { useHomepageLock } from './HomepageLock'
import { LockedFieldset } from '@/components/admin/kit'
import type { SectionOptions } from './editors/fields'

/** Persist a partial config merge onto a section, updating local state and the API. */
export type SaveSectionConfig = (config: Record<string, unknown>) => void

interface Props {
  initial: HomepageSection[]
  /** Which homepage: the store's, or the business homepage (which has no listing pages). */
  audience?: HomepageAudience
  /** Which layout these rows belong to; new sections are created on it. */
  surface?: HomepageSurface
  /** Which page's layout: the homepage, or a listing where sections sit between the products. */
  page?: HomepagePage
  /** How many sections the desktop layout of this page has, for the "Start from desktop" offer. */
  desktopCount?: number
  /** Business: the store layout "Start from the store homepage" copies. */
  storeSource?: HomepageSurface
  /** The section types the tenant's plan includes; absent means every type. */
  planTypes?: SectionType[]
  /** The plan that unlocks each type the plan lacks, by name. */
  upgrade?: Partial<Record<SectionType, string>>
  options?: SectionOptions
  /** Rendered inside the expanded `hero` row — the slide editor lives there. */
  heroEditor?: React.ReactNode
  /** Render every section's editor open and non-collapsible (dedicated Homepage page). */
  alwaysExpanded?: boolean
}

export default function HomepageSectionManager({
  initial,
  audience = 'store',
  surface = 'web',
  page = 'home',
  desktopCount = 0,
  storeSource = 'web',
  planTypes,
  upgrade,
  options,
  heroEditor,
  alwaysExpanded = false,
}: Props) {
  const { showToast, showConfirm } = useToast()
  const homepage = useHomepageLock()
  // Read-only while another admin holds the homepage draft.
  const canWrite = useCanWrite('settings:write') && !homepage.readOnly
  const [sections, setSections] = useState(() => initial.filter(s => rowAudience(s) === audience))
  const [picking, setPicking] = useState(false)
  const [addedId, setAddedId] = useState<string | null>(null)
  const [copying, setCopying] = useState<'desktop' | 'store' | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const usedTypes = new Set(sections.map(s => s.type))
  const pickable = sectionTypesFor(surface, page, audience)
  const listing = page !== 'home'
  const business = audience === 'business'
  const layoutName = surface === 'app' ? 'The app' : 'Phone browsers'
  const inPlan = (type: SectionType) => !planTypes || planTypes.includes(type)
  const planHint = (type: SectionType) => (upgrade?.[type] ? `Comes with ${upgrade[type]}` : 'Not in your plan')
  // Why a type can't be added right now, or null when it can.
  const blockedReason = (type: SectionType): string | null => {
    if (!inPlan(type)) return planHint(type)
    const meta = SECTION_META[type]
    if (meta.singleton && usedTypes.has(type)) return 'Already on the page'
    const clash = meta.excludes?.find(e => usedTypes.has(e))
    return clash ? `Can't be combined with ${SECTION_META[clash].label}` : null
  }

  // "Start from the desktop layout" (this homepage's desktop rows) or, on the business homepage, "Start from
  // the store homepage": copies that layout's sections (and, on the homepage, its slides) onto this one with
  // new ids, then reloads so both managers (and the hero editor) pick up the rows. A 409 means this layout
  // already has rows of its own: confirm, then replace them.
  async function copyLayout(source: 'desktop' | 'store', replace = false) {
    const name = source === 'store' ? 'store homepage' : 'desktop layout'
    const from = source === 'store' ? storeSource : 'web'
    const fromAudience = source === 'store' ? 'store' : audience
    setCopying(source)
    try {
      const res = await fetch('/api/admin/homepage-draft/copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...homepage.headers() },
        credentials: 'include',
        body: JSON.stringify({ from, to: surface, page, audience, fromAudience, ...(replace ? { replace } : {}) }),
      })
      if (await homepage.locked(res)) {
        setCopying(null)
        return
      }
      const data = await res.json().catch(() => ({}))
      if (res.status === 409 && !replace) {
        setCopying(null)
        const ok = await showConfirm({
          title: 'Replace this layout?',
          message: `This layout already has its own sections or slides. Replace them with a copy of the ${name}? It only changes the draft until you publish.`,
          confirmText: 'Replace',
          type: 'danger',
        })
        if (ok) await copyLayout(source, true)
        return
      }
      if (!res.ok) {
        showToast(data.error || `Failed to copy the ${name}`, 'error')
        setCopying(null)
        return
      }
      showToast(`${source === 'store' ? 'Store homepage' : 'Desktop layout'} copied to the draft`, 'success')
      notifyHomepageDraftChanged()
      window.location.reload()
    } catch {
      showToast(`Failed to copy the ${name}`, 'error')
      setCopying(null)
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/admin/homepage-sections/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...homepage.headers() },
      credentials: 'include',
      body: JSON.stringify(body),
    })
    if (await homepage.locked(res)) return
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
      headers: { 'Content-Type': 'application/json', ...homepage.headers() },
      credentials: 'include',
      body: JSON.stringify({ type, surface, page, audience }),
    })
    if (!res.ok) {
      if (!(await homepage.locked(res))) {
        const data = await res.json().catch(() => ({}))
        showToast(data.error || 'Failed to add section', 'error')
      }
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
    const res = await fetch(`/api/admin/homepage-sections/${section.id}`, { method: 'DELETE', credentials: 'include', headers: homepage.headers() })
    if (!res.ok) {
      if (!(await homepage.locked(res))) showToast('Failed to remove', 'error')
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
      headers: { 'Content-Type': 'application/json', ...homepage.headers() },
      credentials: 'include',
      body: JSON.stringify({ order: reordered.map(s => s.id) }),
    })
    if (!res.ok) {
      setSections(previous)
      if (!(await homepage.locked(res))) showToast('Failed to reorder', 'error')
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
                listing={listing}
                canWrite={canWrite}
                inPlan={inPlan(section.type)}
                planNeeds={upgrade?.[section.type] ?? null}
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

      {!business && sections.length === 0 && surface === 'web' && (
        <p className="text-xs text-foreground-muted">
          {listing
            ? 'No sections here yet. Add one and choose after how many products it appears; it shows between the products on every page of this kind.'
            : 'No sections configured — the homepage is using its built-in default layout.'}
        </p>
      )}

      {!business && sections.length === 0 && surface !== 'web' && (listing ? desktopCount > 0 : true) && (
        <div className="rounded-lg border border-dashed border-border-secondary p-4 space-y-3">
          <div>
            <p className="text-sm font-medium text-foreground">{layoutName} show the desktop layout</p>
            <p className="text-xs text-foreground-muted mt-0.5">
              Give this layout its own sections by starting from a copy of the desktop layout, or add sections below.
              The desktop layout stays as it is.
            </p>
          </div>
          {canWrite && (
            <button
              type="button"
              disabled={!!copying}
              onClick={() => copyLayout('desktop')}
              className="inline-flex items-center gap-1.5 px-3 h-control text-sm font-medium rounded-lg bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-50"
            >
              <Copy className="w-4 h-4" /> {copying ? 'Copying…' : 'Start from the desktop layout'}
            </button>
          )}
        </div>
      )}

      {/* Business layouts mirror the business desktop one, then the store homepage, until they have rows. */}
      {business && sections.length === 0 && (
        <div className="rounded-lg border border-dashed border-border-secondary p-4 space-y-3">
          <div>
            <p className="text-sm font-medium text-foreground">
              {surface !== 'web' && desktopCount > 0
                ? `${layoutName} show the business desktop layout`
                : surface === 'web'
                  ? 'Business accounts see the store homepage'
                  : `${layoutName} show the store homepage`}
            </p>
            <p className="text-xs text-foreground-muted mt-0.5">
              {surface !== 'web' && desktopCount > 0
                ? 'Give this layout its own sections by starting from a copy of the business desktop layout or of the store homepage, or add sections below.'
                : 'Give business accounts a homepage of their own by starting from a copy of the store homepage, or add sections below. The store homepage stays as it is.'}
            </p>
          </div>
          {canWrite && (
            <div className="flex flex-wrap gap-2">
              {surface !== 'web' && desktopCount > 0 && (
                <button
                  type="button"
                  disabled={!!copying}
                  onClick={() => copyLayout('desktop')}
                  className="inline-flex items-center gap-1.5 px-3 h-control text-sm font-medium rounded-lg bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-50"
                >
                  <Copy className="w-4 h-4" /> {copying === 'desktop' ? 'Copying…' : 'Start from the desktop layout'}
                </button>
              )}
              <button
                type="button"
                disabled={!!copying}
                onClick={() => copyLayout('store')}
                className={
                  surface !== 'web' && desktopCount > 0
                    ? 'inline-flex items-center gap-1.5 px-3 h-control text-sm font-medium rounded-lg border border-border-secondary text-foreground hover:bg-surface-secondary disabled:opacity-50'
                    : 'inline-flex items-center gap-1.5 px-3 h-control text-sm font-medium rounded-lg bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-50'
                }
              >
                <Copy className="w-4 h-4" /> {copying === 'store' ? 'Copying…' : 'Start from the store homepage'}
              </button>
            </div>
          )}
        </div>
      )}

      {canWrite && (
        <div>
          <button
            type="button"
            onClick={() => setPicking(p => !p)}
            className="inline-flex items-center gap-1.5 px-3 h-control text-sm font-medium rounded-lg border border-border-secondary text-foreground hover:bg-surface-secondary"
          >
            <Plus className="w-4 h-4" /> Add section
          </button>

          {picking && (
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
              {pickable.map(type => {
                const meta = SECTION_META[type]
                const blocked = blockedReason(type)
                return (
                  <button
                    key={type}
                    type="button"
                    disabled={!!blocked}
                    onClick={() => addSection(type)}
                    className="text-left p-3 rounded-lg border border-border-default hover:border-accent-400 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                      {meta.label}
                      {!inPlan(type) && <Lock className="w-3 h-3 text-foreground-muted" aria-hidden="true" />}
                    </span>
                    <span className="block text-xs text-foreground-muted mt-0.5">{blocked ?? meta.description}</span>
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
  /** On a listing page: show where the section sits between the products. */
  listing?: boolean
  canWrite: boolean
  /** False when the plan lacks the type: the row can only be removed. */
  inPlan?: boolean
  /** The plan that unlocks the type, by name. */
  planNeeds?: string | null
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
  listing = false,
  canWrite,
  inPlan = true,
  planNeeds = null,
  options,
  onChange,
  onSave,
  onRemove,
  extra,
  alwaysExpanded = false,
  defaultOpen = false,
}: RowProps) {
  const placement = listing ? sectionPlacement(section) : null
  const where = placement
    ? `After ${placement.after}${placement.every ? ` · every ${placement.every}` : ''}`
    : null
  const [expanded, setExpanded] = useState(alwaysExpanded || defaultOpen)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: section.id })
  const meta = SECTION_META[section.type]
  const open = alwaysExpanded || expanded
  const editable = canWrite && inPlan
  const planBadge = inPlan ? null : (
    <span
      title={planNeeds ? `Comes with ${planNeeds}` : 'Not in your plan'}
      className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-400 truncate"
    >
      Not in your plan — hidden on the storefront
    </span>
  )

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
            {where && (
              <span className="text-[10px] tabular-nums px-1.5 py-0.5 rounded bg-accent-500/10 text-accent-600 dark:text-accent-400 shrink-0">
                {where}
              </span>
            )}
            {!section.is_active && (
              <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-surface-secondary text-foreground-muted shrink-0">
                Hidden
              </span>
            )}
            {planBadge}
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
            {where && (
              <span className="text-[10px] tabular-nums px-1.5 py-0.5 rounded bg-accent-500/10 text-accent-600 dark:text-accent-400 shrink-0">
                {where}
              </span>
            )}
            {!section.is_active && (
              <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-surface-secondary text-foreground-muted shrink-0">
                Hidden
              </span>
            )}
            {planBadge}
            <ChevronDown
              className={`w-4 h-4 ml-auto shrink-0 text-foreground-muted transition-transform ${expanded ? 'rotate-180' : ''}`}
            />
          </button>
        )}

        <Toggle
          checked={section.is_active}
          disabled={!editable}
          onChange={next => {
            onChange(section.id, { is_active: next })
            onSave(section.id, { isActive: next })
          }}
        />
      </div>

      <div className={open ? 'px-3 pb-3 pt-1 space-y-3 border-t border-border-default' : 'hidden'}>
        {!inPlan && (
          <p className="text-xs text-foreground-muted rounded-lg border border-border-default bg-surface-secondary/40 px-3 py-2">
            {meta.label} isn&apos;t in your plan, so it&apos;s hidden on the storefront
            {planNeeds ? `; it comes with ${planNeeds}` : ''}. You can still remove it.
          </p>
        )}
        {open && <SectionPreview section={section} />}
        {extra}
        <LockedFieldset readOnly={!editable}>
          <SectionConfigFields
            section={section}
            canWrite={editable}
            options={options}
            onChange={onChange}
            onSave={onSave}
          />
        </LockedFieldset>
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
