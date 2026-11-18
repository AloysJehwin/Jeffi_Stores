'use client'

import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import {
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  closestCenter,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy, type SortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, GripVertical, Trash2 } from 'lucide-react'
import { blockPlace, type Block, type PageDoc } from '@jeffi/site-blocks'
import { isSectionBlock, siteRegistry } from '@/lib/site/blocks'

// The page's blocks as sortable lists (dnd-kit): the top level, and each Products block's "between products" slot.
// A block drags within its list or across lists (only sections go between products), and a block from the library
// drags in at a position. Pointer and keyboard; the dragged row stays in place as the drop indicator.

/** What is being dragged: a block on the page, or a new one from the library (a type, or a saved block). */
export type DragItem = { kind: 'block'; id: string } | { kind: 'new'; type: string; label: string; saved?: Block }
export type NewItem = Extract<DragItem, { kind: 'new' }>
export type Parent = { id: string; slot: string }
type Lists = Record<string, string[]>

const TOP = 'top'
const SLOT = 'slot:'
/** Droppable ids of whole lists (an empty slot, the space below the last block). */
const LIST = 'list:'
const NEW_ID = '__new__'
/** Draggable ids of library entries. */
export const LIBRARY = 'lib:'

const hostOf = (list: string) => (list.startsWith(SLOT) ? list.slice(SLOT.length) : null)
const parentOf = (list: string): Parent | undefined => {
  const host = hostOf(list)
  return host ? { id: host, slot: 'between' } : undefined
}

function listsOf(doc: PageDoc | undefined): Lists {
  const out: Lists = { [TOP]: doc ? [...doc.order] : [] }
  for (const id of doc?.order ?? []) {
    const b = doc!.blocks[id]
    if (b && siteRegistry.get(b.type)?.slots?.includes('between')) out[SLOT + id] = (b.children?.between ?? []).filter(c => doc!.blocks[c])
  }
  return out
}

export const blockLabel = (b: Block) =>
  String((b.props as { title?: unknown }).title || (b.type === 'code_section' && b.props.label) || siteRegistry.get(b.type)?.label || b.type)

// While a library entry drags, the lists' own items stay put (its placeholder takes the room).
const sorting: SortingStrategy = args => (args.activeIndex < 0 ? null : verticalListSortingStrategy(args))

export const DND_MEASURING = { droppable: { strategy: MeasuringStrategy.Always } }

export function useBlockDnd(
  doc: PageDoc | undefined,
  opts: { onMove: (id: string, at: number, parent?: Parent) => void; onInsert: (item: NewItem, at: number, parent?: Parent) => void }
) {
  const [drag, setDrag] = useState<{ item: DragItem; lists: Lists } | null>(null)
  // Just after a row changed lists the layout shifts under the pointer; one frame passes before it may move again.
  const settling = useRef(false)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const lists = drag?.lists ?? listsOf(doc)

  const isSection = (item: DragItem) => (item.kind === 'new' ? isSectionBlock(item.type) : isSectionBlock(doc?.blocks[item.id]?.type ?? ''))
  const listOf = (ls: Lists, id: string) => (id.startsWith(LIST) ? id.slice(LIST.length) : Object.keys(ls).find(k => ls[k].includes(id)))
  // Only sections go between products (and a Products block never into its own slot).
  const accepts = (list: string, item: DragItem) => list === TOP || (isSection(item) && !(item.kind === 'block' && hostOf(list) === item.id))

  // The innermost list or row under the pointer; in a list, its nearest row. The keyboard moves row to row.
  const collision: CollisionDetection = args => {
    if (!args.pointerCoordinates) return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter(c => !String(c.id).startsWith(LIST)) })
    const hits = pointerWithin(args)
    const found = hits.length ? hits : rectIntersection(args)
    if (!found.length) return []
    const area = (id: string | number) => {
      const r = args.droppableRects.get(id)
      return r ? r.width * r.height : Infinity
    }
    const inner = [...found].sort((a, b) => area(a.id) - area(b.id))[0]
    const id = String(inner.id)
    if (!id.startsWith(LIST)) return [inner]
    const items = lists[id.slice(LIST.length)] ?? []
    const within = args.droppableContainers.filter(c => items.includes(String(c.id)))
    return within.length ? closestCenter({ ...args, droppableContainers: within }) : [inner]
  }

  function onDragStart(e: DragStartEvent) {
    const item = (e.active.data.current as { item?: DragItem } | undefined)?.item ?? { kind: 'block' as const, id: String(e.active.id) }
    setDrag({ item, lists: listsOf(doc) })
  }

  // Across lists (and for a library entry, anywhere) the row moves now, so its list makes room; within a list the
  // sortable strategy shows the move and the drop applies it.
  function onDragOver(e: DragOverEvent) {
    const { active, over } = e
    if (!drag || !over || settling.current) return
    const overId = String(over.id)
    const { item } = drag
    const moving = item.kind === 'block' ? item.id : NEW_ID
    if (overId === moving) return
    const from = listOf(drag.lists, moving)
    const to = listOf(drag.lists, overId)
    if (!to || !accepts(to, item) || (item.kind === 'block' && from === to)) return
    const rest = drag.lists[to].filter(x => x !== moving)
    let at = overId.startsWith(LIST) ? rest.length : rest.indexOf(overId)
    if (at < 0) at = rest.length
    else if (!overId.startsWith(LIST)) {
      const r = active.rect.current.translated
      if (r && r.top + r.height / 2 > over.rect.top + over.rect.height / 2) at += 1
    }
    if (from === to && drag.lists[to].indexOf(moving) === at) return
    const next = { ...drag.lists }
    if (from) next[from] = next[from].filter(x => x !== moving)
    next[to] = [...rest.slice(0, at), moving, ...rest.slice(at)]
    setDrag({ ...drag, lists: next })
    settling.current = true
    requestAnimationFrame(() => (settling.current = false))
  }

  function onDragEnd(e: DragEndEvent) {
    const d = drag
    setDrag(null)
    if (!d || !doc) return
    const { item } = d
    if (item.kind === 'new') {
      const list = listOf(d.lists, NEW_ID)
      if (list && e.over) opts.onInsert(item, d.lists[list].indexOf(NEW_ID), parentOf(list))
      return
    }
    // Dropped outside the lists: nothing moves.
    if (!e.over) return
    let ls = d.lists
    const list = listOf(ls, item.id)
    if (!list) return
    const overId = String(e.over.id)
    if (overId !== item.id && !overId.startsWith(LIST) && listOf(ls, overId) === list) {
      const ids = ls[list]
      ls = { ...ls, [list]: arrayMove(ids, ids.indexOf(item.id), ids.indexOf(overId)) }
    }
    const at = ls[list].indexOf(item.id)
    const parent = parentOf(list)
    const was = blockPlace(doc, item.id)
    if (was && was.index === at && (was.parent?.id ?? null) === (parent?.id ?? null)) return
    opts.onMove(item.id, at, parent)
  }

  const dragging = drag?.item
  const label = dragging ? (dragging.kind === 'new' ? dragging.label : doc?.blocks[dragging.id] ? blockLabel(doc.blocks[dragging.id]) : '') : ''
  return { sensors, collision, lists, dragging, label, onDragStart, onDragOver, onDragEnd, onDragCancel: () => setDrag(null) }
}

export interface RowActions {
  select: (id: string) => void
  move: (id: string, delta: number) => void
  toggleHidden: (id: string) => void
  duplicate: (id: string) => void
  remove: (id: string) => void
}

function Row({
  block,
  index,
  count,
  selected,
  canWrite,
  disabled,
  actions,
  children,
}: {
  block: Block
  index: number
  count: number
  selected: boolean
  canWrite: boolean
  disabled?: boolean
  actions: RowActions
  children?: ReactNode
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
    data: { item: { kind: 'block', id: block.id } satisfies DragItem },
    disabled: !canWrite || disabled,
  })
  const def = siteRegistry.get(block.type)
  const label = blockLabel(block)
  const hidden = !!block.visibility?.hidden
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} className="relative">
      <div
        className={`group flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-sm ${
          isDragging ? 'border-dashed border-accent-500 bg-accent-500/10' : selected ? 'border-accent-500 bg-accent-500/5' : 'border-border-default bg-surface-elevated'
        } ${hidden && !isDragging ? 'opacity-60' : ''}`}
      >
        {canWrite ? (
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            className="shrink-0 cursor-grab touch-none rounded p-0.5 text-foreground-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500"
            aria-label={`Drag to move ${label}`}
            title="Drag to move (or focus and use Space, then the arrow keys)"
          >
            <GripVertical className="w-3.5 h-3.5" />
          </button>
        ) : (
          <GripVertical className="w-3.5 h-3.5 shrink-0 text-foreground-muted opacity-40" />
        )}
        <button type="button" className="flex-1 min-w-0 text-left truncate" onClick={() => actions.select(block.id)}>
          {label}
        </button>
        {hidden && <EyeOff className="w-3.5 h-3.5 shrink-0 text-foreground-muted" aria-label="Hidden" />}
        {canWrite && def?.locked && <span className="text-[10px] uppercase tracking-wide text-foreground-muted">Core</span>}
        {canWrite && !isDragging && (
          <span className="hidden group-hover:flex group-focus-within:flex items-center gap-0.5">
            <button type="button" className="p-0.5 disabled:opacity-30" disabled={index === 0} onClick={() => actions.move(block.id, -1)} aria-label="Move up">
              <ArrowUp className="w-3.5 h-3.5" />
            </button>
            <button type="button" className="p-0.5 disabled:opacity-30" disabled={index === count - 1} onClick={() => actions.move(block.id, 1)} aria-label="Move down">
              <ArrowDown className="w-3.5 h-3.5" />
            </button>
            <button type="button" className="p-0.5" onClick={() => actions.toggleHidden(block.id)} aria-label={hidden ? 'Show' : 'Hide'}>
              {hidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            </button>
            {!def?.locked && (
              <button type="button" className="p-0.5" onClick={() => actions.duplicate(block.id)} aria-label="Duplicate">
                <Copy className="w-3.5 h-3.5" />
              </button>
            )}
            {!def?.locked && (
              <button type="button" className="p-0.5 text-red-600" onClick={() => actions.remove(block.id)} aria-label="Remove">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </span>
        )}
      </div>
      {children}
    </li>
  )
}

function Placeholder({ label }: { label: string }) {
  return (
    <li className="flex h-9 items-center rounded-lg border-2 border-dashed border-accent-500 bg-accent-500/10 px-2 text-xs font-medium text-accent-600" aria-hidden>
      Drop “{label}” here
    </li>
  )
}

function Slot({ hostId, ids, doc, ...rest }: { hostId: string; ids: string[]; doc: PageDoc; selected: string | null; canWrite: boolean; disabled: boolean; label: string; actions: RowActions }) {
  const { setNodeRef } = useDroppable({ id: LIST + SLOT + hostId, disabled: rest.disabled })
  const shown = ids.filter(id => id === NEW_ID || doc.blocks[id])
  return (
    <div ref={setNodeRef} className="ml-3 mt-1 space-y-1 border-l-2 border-dashed border-border-secondary pb-1 pl-2">
      <p className="text-[11px] uppercase tracking-wide text-foreground-muted">Between products</p>
      <SortableContext id={SLOT + hostId} items={shown.filter(id => id !== NEW_ID)} strategy={sorting}>
        <ul className="space-y-1">
          {shown.map((id, i) =>
            id === NEW_ID ? (
              <Placeholder key={id} label={rest.label} />
            ) : (
              <Row key={id} block={doc.blocks[id]} index={i} count={shown.length} selected={rest.selected === id} canWrite={rest.canWrite} disabled={rest.disabled} actions={rest.actions} />
            )
          )}
        </ul>
      </SortableContext>
      {!shown.length && <p className="text-xs text-foreground-muted">Drag a section here, or select Products and add one, to show it between the products.</p>}
    </div>
  )
}

/** The page's blocks; render inside the editor's DndContext (the library drags into the same context). */
export function BlockList({ doc, dnd, selected, canWrite, actions }: { doc: PageDoc; dnd: ReturnType<typeof useBlockDnd>; selected: string | null; canWrite: boolean; actions: RowActions }) {
  const { setNodeRef } = useDroppable({ id: LIST + TOP })
  const top = dnd.lists[TOP].filter(id => id === NEW_ID || doc.blocks[id])
  const draggingId = dnd.dragging?.kind === 'block' ? dnd.dragging.id : null
  return (
    <SortableContext id={TOP} items={top.filter(id => id !== NEW_ID)} strategy={sorting}>
      <ul ref={setNodeRef} className="space-y-1 min-h-10 pb-6">
        {top.map((id, i) => {
          if (id === NEW_ID) return <Placeholder key={id} label={dnd.label} />
          const b = doc.blocks[id]
          const slot = dnd.lists[SLOT + id]
          return (
            <Row key={id} block={b} index={i} count={top.length} selected={selected === id} canWrite={canWrite} actions={actions}>
              {slot && <Slot hostId={id} ids={slot} doc={doc} selected={selected} canWrite={canWrite} disabled={draggingId === id} label={dnd.label} actions={actions} />}
            </Row>
          )
        })}
      </ul>
    </SortableContext>
  )
}

/** A library entry the owner can drag into the list (a click still adds it after the selected block). */
export function useLibraryDrag(item: NewItem, disabled: boolean) {
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: `${LIBRARY}${item.saved ? `saved:${item.saved.id}` : item.type}`, data: { item }, disabled })
  // Pointer only: Enter and Space keep adding by click.
  return { ref: setNodeRef, onPointerDown: listeners?.onPointerDown as ((e: ReactPointerEvent) => void) | undefined, isDragging }
}
