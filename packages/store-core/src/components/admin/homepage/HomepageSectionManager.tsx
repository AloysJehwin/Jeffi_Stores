'use client'

import { Fragment, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { ArrowLeftRight, ChevronDown, Copy, GripVertical, Lock, Maximize2, Plus, Trash2 } from 'lucide-react'
import Toggle from '@/components/ui/Toggle'
import { useToast } from '@/contexts/ToastContext'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import {
  SECTION_META,
  groupRows,
  HOMEPAGE_SURFACES,
  rowAudience,
  rowSurface,
  sectionPlacement,
  sectionSide,
  sectionTypesFor,
  type HomepageAudience,
  type HomepagePage,
  type HomepageSection,
  type HomepageSurface,
  type SectionSide,
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
  /** Which page's layout: the homepage, or a listing where sections sit between the products. */
  page?: HomepagePage
  /** The section types the tenant's plan includes; absent means every type. */
  planTypes?: SectionType[]
  /** The plan that unlocks each type the plan lacks, by name. */
  upgrade?: Partial<Record<SectionType, string>>
  options?: SectionOptions
  /** Rendered inside the expanded `hero` row — the slide editor lives there. */
  heroEditor?: React.ReactNode
  /** Render every section's editor open and non-collapsible (dedicated Homepage page). */
  alwaysExpanded?: boolean
  /** The device whose layout this edits; every device has its own. */
  surface?: HomepageSurface
  /** False for a store without a mobile app: no app layout to copy from. */
  hasApp?: boolean
}

const SURFACE_NAME: Record<HomepageSurface, string> = { web: 'Desktop web', web_mobile: 'Mobile web', app: 'App' }

const withSide = (s: HomepageSection, side: SectionSide): HomepageSection => {
  const { layout: _l, ...rest } = s.config ?? {}
  return { ...s, config: side === 'full' ? rest : { ...rest, layout: { side } } }
}

type Drop = { kind: 'gap'; before: string | null } | { kind: 'slot'; target: string; side: 'left' | 'right' }

function parseDrop(id: string): Drop | null {
  if (id === 'gap:end') return { kind: 'gap', before: null }
  if (id.startsWith('gap:')) return { kind: 'gap', before: id.slice(4) }
  const m = id.match(/^slot:(.+):(left|right)$/)
  return m ? { kind: 'slot', target: m[1], side: m[2] as 'left' | 'right' } : null
}

/**
 * The layout after dropping `activeId` on `drop`: the dragged section leaves its row (its partner
 * goes full width), then lands full width between rows or beside a full-width section.
 */
export function applyDrop(sections: HomepageSection[], activeId: string, drop: Drop): HomepageSection[] | null {
  const dragged = sections.find(s => s.id === activeId)
  if (!dragged) return null
  const partner = groupRows(sections).find(r => r.some(s => s.id === activeId))?.find(s => s.id !== activeId)
  const rest = sections.filter(s => s.id !== activeId).map(s => (partner && s.id === partner.id ? withSide(s, 'full') : s))
  if (drop.kind === 'gap') {
    const at = drop.before ? rest.findIndex(s => s.id === drop.before) : rest.length
    if (at < 0) return null
    return [...rest.slice(0, at), withSide(dragged, 'full'), ...rest.slice(at)]
  }
  const at = rest.findIndex(s => s.id === drop.target)
  if (at < 0) return null
  const target = rest[at]
  const left = drop.side === 'left' ? withSide(dragged, 'left') : withSide(target, 'left')
  const right = drop.side === 'left' ? withSide(target, 'right') : withSide(dragged, 'right')
  return [...rest.slice(0, at), left, right, ...rest.slice(at + 1)]
}

export default function HomepageSectionManager({
  initial,
  audience = 'store',
  page = 'home',
  planTypes,
  upgrade,
  options,
  heroEditor,
  alwaysExpanded = false,
  surface = 'web',
  hasApp = true,
}: Props) {
  const { showToast, showConfirm } = useToast()
  const homepage = useHomepageLock()
  // Read-only while another admin holds the homepage draft.
  const canWrite = useCanWrite('settings:write') && !homepage.readOnly
  const [sections, setSections] = useState(() => initial.filter(s => rowAudience(s) === audience && rowSurface(s) === surface))
  const [picking, setPicking] = useState(false)
  const [addedId, setAddedId] = useState<string | null>(null)
  const [copying, setCopying] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const usedTypes = new Set(sections.map(s => s.type))
  const pickable = sectionTypesFor('all', page, audience)
  const listing = page !== 'home'
  const business = audience === 'business'
  const rows = groupRows(sections)
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

  const sourceName = (from: HomepageSurface, fromAudience: HomepageAudience) =>
    fromAudience !== audience ? `the store homepage (${SURFACE_NAME[from]})` : `the ${SURFACE_NAME[from]} layout`

  // Copies another layout's sections (and, on the homepage, its hero slides) onto this device's layout
  // with new ids, then reloads so the managers and the hero editor pick up the rows. A 409 means this
  // layout already has rows of its own: confirm, then replace them.
  async function copyFrom(from: HomepageSurface, fromAudience: HomepageAudience = audience, replace = false) {
    setCopying(true)
    try {
      const res = await fetch('/api/admin/homepage-draft/copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...homepage.headers() },
        credentials: 'include',
        body: JSON.stringify({ from, to: surface, page, audience, fromAudience, ...(replace ? { replace } : {}) }),
      })
      if (await homepage.locked(res)) {
        setCopying(false)
        return
      }
      const data = await res.json().catch(() => ({}))
      if (res.status === 409 && !replace) {
        setCopying(false)
        const ok = await showConfirm({
          title: `Replace the ${SURFACE_NAME[surface]} layout?`,
          message: `Its sections${page === 'home' ? ' and hero slides' : ''} are replaced with a copy of ${sourceName(from, fromAudience)}. Other devices are not changed, and nothing goes live until you publish.`,
          confirmText: 'Replace',
          type: 'danger',
        })
        if (ok) await copyFrom(from, fromAudience, true)
        return
      }
      if (!res.ok) {
        showToast(data.error || 'Failed to copy the layout', 'error')
        setCopying(false)
        return
      }
      showToast(`Copied ${sourceName(from, fromAudience)} to the draft`, 'success')
      notifyHomepageDraftChanged()
      window.location.reload()
    } catch {
      showToast('Failed to copy the layout', 'error')
      setCopying(false)
    }
  }
  const otherSurfaces = HOMEPAGE_SURFACES.filter(s => s !== surface && (hasApp || s !== 'app'))

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
      body: JSON.stringify({ type, page, audience, surface }),
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
    // The other half of its row goes full width.
    const partner = groupRows(sections).find(r => r.some(s => s.id === section.id))?.find(s => s.id !== section.id)
    const next = sections.filter(s => s.id !== section.id).map(s => (partner && s.id === partner.id ? withSide(s, 'full') : s))
    setSections(next)
    if (partner) await saveLayout(next, sections)
    showToast('Section removed from draft', 'success')
    notifyHomepageDraftChanged()
  }

  /** Saves the order and every side that changed (one PATCH); rolls back to `previous` on failure. */
  async function saveLayout(next: HomepageSection[], previous: HomepageSection[]) {
    const was = new Map(previous.map(s => [s.id, sectionSide(s)]))
    const sides: Record<string, SectionSide> = {}
    for (const s of next) if (was.get(s.id) !== sectionSide(s)) sides[s.id] = sectionSide(s)
    const res = await fetch('/api/admin/homepage-sections', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...homepage.headers() },
      credentials: 'include',
      body: JSON.stringify({ order: next.map(s => s.id), sides }),
    })
    if (!res.ok) {
      setSections(previous)
      if (!(await homepage.locked(res))) showToast('Failed to save the layout', 'error')
      return
    }
    notifyHomepageDraftChanged()
  }

  async function onDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveId(null)
    if (!over) return
    const drop = parseDrop(String(over.id))
    if (!drop) return
    const next = applyDrop(sections, String(active.id), drop)
    if (!next || next.map(s => s.id + sectionSide(s)).join() === sections.map(s => s.id + sectionSide(s)).join()) return
    const previous = sections
    setSections(next)
    await saveLayout(next, previous)
  }

  function swapRow(row: HomepageSection[]) {
    const [l, r] = row
    const at = sections.findIndex(s => s.id === l.id)
    const next = [...sections.slice(0, at), withSide(r, 'left'), withSide(l, 'right'), ...sections.slice(at + 2)]
    const previous = sections
    setSections(next)
    void saveLayout(next, previous)
  }

  function makeFull(row: HomepageSection[]) {
    const ids = new Set(row.map(s => s.id))
    const next = sections.map(s => (ids.has(s.id) ? withSide(s, 'full') : s))
    const previous = sections
    setSections(next)
    void saveLayout(next, previous)
  }

  const dragging = activeId ? sections.find(s => s.id === activeId) : null
  const rowProps = (section: HomepageSection) => ({
    section,
    listing,
    canWrite,
    inPlan: inPlan(section.type),
    planNeeds: upgrade?.[section.type] ?? null,
    options,
    onChange: update,
    onSave: patch,
    onRemove: removeSection,
    alwaysExpanded,
    defaultOpen: section.id === addedId,
    extra:
      section.type === 'hero' ? (
        heroEditor
      ) : section.type === 'offer_slider' ? (
        <OfferSliderControl section={section} saveConfig={config => saveConfigFor(section, config)} />
      ) : undefined,
  })

  return (
    <div className="space-y-4">
      <DndContext id="homepage-sections" sensors={sensors} collisionDetection={pointerWithin} onDragStart={e => setActiveId(String(e.active.id))} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
        <div className="space-y-1">
          {rows.map((row, ri) => (
            <Fragment key={row[0].id}>
              <Gap id={`gap:${row[0].id}`} active={!!dragging} />
              {row.length === 2 ? (
                <div className="grid md:grid-cols-2 gap-2 rounded-xl border border-dashed border-accent-500/40 p-1.5">
                  {row.map((section, i) => (
                    <SectionRow
                      key={section.id}
                      position={`${ri + 1}${i === 0 ? 'a' : 'b'}`}
                      half={i === 0 ? 'left' : 'right'}
                      onSwap={canWrite ? () => swapRow(row) : undefined}
                      onFull={canWrite ? () => makeFull(row) : undefined}
                      {...rowProps(section)}
                    />
                  ))}
                </div>
              ) : (
                <div className="relative">
                  <SectionRow position={String(ri + 1)} {...rowProps(row[0])} />
                  {dragging && dragging.id !== row[0].id && (
                    <div className="absolute inset-0 grid grid-cols-2 gap-2 p-1 pointer-events-none">
                      <Slot id={`slot:${row[0].id}:left`} label="Left half" />
                      <Slot id={`slot:${row[0].id}:right`} label="Right half" />
                    </div>
                  )}
                </div>
              )}
            </Fragment>
          ))}
          <Gap id="gap:end" active={!!dragging} />
        </div>
        <DragOverlay dropAnimation={null}>
          {dragging ? (
            <div className="rounded-lg border border-accent-400 bg-surface px-3 py-2 text-sm font-medium text-foreground shadow-lg">
              {dragging.title || SECTION_META[dragging.type].label}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {!business && sections.length === 0 && (
        <div className="rounded-lg border border-dashed border-border-secondary p-4 space-y-3">
          <p className="text-xs text-foreground-muted">
            {listing
              ? `No sections on ${SURFACE_NAME[surface]} here yet. Add one and choose after how many products it appears; it shows between the products on every page of this kind.`
              : `No sections on ${SURFACE_NAME[surface]} yet, so it shows the built-in default layout. Start from another device's layout, or add sections below.`}
          </p>
          {canWrite && (
            <div className="flex flex-wrap gap-2">
              {otherSurfaces.map(s => (
                <button
                  key={s}
                  type="button"
                  disabled={copying}
                  onClick={() => copyFrom(s)}
                  className="inline-flex items-center gap-1.5 px-3 h-control text-sm font-medium rounded-lg border border-border-secondary text-foreground hover:bg-surface-secondary disabled:opacity-50"
                >
                  <Copy className="w-4 h-4" /> Start from {SURFACE_NAME[s]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* The business homepage shows the store homepage until it has rows of its own. */}
      {business && sections.length === 0 && (
        <div className="rounded-lg border border-dashed border-border-secondary p-4 space-y-3">
          <div>
            <p className="text-sm font-medium text-foreground">Business accounts see the store homepage</p>
            <p className="text-xs text-foreground-muted mt-0.5">
              Give business accounts a homepage of their own by starting from a copy of the store homepage, or add sections below. The store homepage stays as it is.
            </p>
          </div>
          {canWrite && (
            <button
              type="button"
              disabled={copying}
              onClick={() => copyFrom(surface, 'store')}
              className="inline-flex items-center gap-1.5 px-3 h-control text-sm font-medium rounded-lg bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-50"
            >
              <Copy className="w-4 h-4" /> {copying ? 'Copying…' : 'Start from the store homepage'}
            </button>
          )}
        </div>
      )}

      {sections.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-foreground-muted">
            This is the {SURFACE_NAME[surface]} layout: every device has its own, so changes here (order, shapes, text) don&apos;t
            touch the others. Drag a section between rows, or onto the left or right half of another to put the two side by
            side on wide screens. The switch on the right hides a section.
          </p>
          {canWrite && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-foreground-muted">
              <span>Replace with a copy of:</span>
              {otherSurfaces.map(s => (
                <button
                  key={s}
                  type="button"
                  disabled={copying}
                  onClick={() => copyFrom(s, audience, false)}
                  className="inline-flex items-center gap-1 px-2 h-7 rounded-md border border-border-secondary text-foreground-secondary hover:bg-surface-secondary disabled:opacity-50"
                >
                  <Copy className="w-3.5 h-3.5" /> {SURFACE_NAME[s]}
                </button>
              ))}
              {business && (
                <button
                  type="button"
                  disabled={copying}
                  onClick={() => copyFrom(surface, 'store', false)}
                  className="inline-flex items-center gap-1 px-2 h-7 rounded-md border border-border-secondary text-foreground-secondary hover:bg-surface-secondary disabled:opacity-50"
                >
                  <Copy className="w-3.5 h-3.5" /> Store homepage
                </button>
              )}
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

/** A drop strip between rows: a thin line that grows while something is dragged over it. */
function Gap({ id, active }: { id: string; active: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div
      ref={setNodeRef}
      className={`rounded transition-all ${active ? (isOver ? 'h-10 bg-accent-500/15 border-2 border-dashed border-accent-500' : 'h-3 border border-dashed border-border-secondary/70') : 'h-1'}`}
    />
  )
}

/** A half of a full-width row, offered while dragging: dropping here makes a two-column row. */
function Slot({ id, label }: { id: string; label: string }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div
      ref={setNodeRef}
      className={`pointer-events-auto rounded-lg border-2 border-dashed flex items-center justify-center text-xs font-medium ${isOver ? 'border-accent-500 bg-accent-500/15 text-accent-600 dark:text-accent-400' : 'border-accent-500/40 bg-surface/70 text-foreground-muted'}`}
    >
      {label}
    </div>
  )
}

interface RowProps {
  section: HomepageSection
  /** Row number, with a / b for the halves of a two-column row. */
  position: string
  /** Which half of a two-column row this is. */
  half?: 'left' | 'right'
  onSwap?: () => void
  onFull?: () => void
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
  half,
  onSwap,
  onFull,
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
  // A right half follows the left one's placement.
  const where = !placement ? null : half === 'right' ? 'With the left half' : `After ${placement.after}${placement.every ? ` · every ${placement.every}` : ''}`
  const [expanded, setExpanded] = useState(alwaysExpanded || defaultOpen)
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({ id: section.id, disabled: !canWrite })
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
  const badges = (
    <>
      <span className="text-xs text-foreground-muted shrink-0 hidden sm:inline">{meta.label}</span>
      {where && (
        <span className="text-[10px] tabular-nums px-1.5 py-0.5 rounded bg-accent-500/10 text-accent-600 dark:text-accent-400 shrink-0">{where}</span>
      )}
      {!section.is_active && (
        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-surface-secondary text-foreground-muted shrink-0">Hidden</span>
      )}
      {planBadge}
    </>
  )

  return (
    <div ref={setNodeRef} className={`rounded-lg border border-border-default bg-surface ${isDragging ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-2 px-3 py-2.5">
        {/* Listeners stay on the grip: on the row they would swallow clicks on the toggle
            and every input inside the expanded editor. */}
        <button
          ref={setActivatorNodeRef}
          type="button"
          className="cursor-grab active:cursor-grabbing text-foreground-muted disabled:opacity-40 touch-none"
          disabled={!canWrite}
          aria-label={`Move ${meta.label}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="w-4 h-4" />
        </button>

        <span className="w-6 text-xs tabular-nums text-foreground-muted shrink-0">{position}</span>

        {alwaysExpanded ? (
          <div className="flex-1 flex items-center gap-2 min-w-0">
            <span className="text-sm font-medium text-foreground truncate">{section.title || meta.label}</span>
            {badges}
          </div>
        ) : (
          <button type="button" onClick={() => setExpanded(e => !e)} aria-expanded={expanded} className="flex-1 flex items-center gap-2 text-left min-w-0">
            <span className="text-sm font-medium text-foreground truncate">{section.title || meta.label}</span>
            {badges}
            <ChevronDown className={`w-4 h-4 ml-auto shrink-0 text-foreground-muted transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
        )}

        {half && (
          <div className="flex items-center gap-0.5 shrink-0">
            {onSwap && (
              <button type="button" onClick={onSwap} title="Swap left and right" className="p-1 rounded text-foreground-muted hover:text-foreground">
                <ArrowLeftRight className="w-3.5 h-3.5" />
              </button>
            )}
            {onFull && (
              <button type="button" onClick={onFull} title="Make both full width" className="p-1 rounded text-foreground-muted hover:text-foreground">
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
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
          <SectionConfigFields section={section} canWrite={editable} options={options} onChange={onChange} onSave={onSave} half={half} />
        </LockedFieldset>
        {canWrite && (
          <button type="button" onClick={() => onRemove(section)} className="inline-flex items-center gap-1.5 text-xs text-red-600 hover:text-red-700">
            <Trash2 className="w-3.5 h-3.5" /> Remove section
          </button>
        )}
      </div>
    </div>
  )
}
