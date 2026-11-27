'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent, type SensorDescriptor, type SensorOptions } from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ChevronRight, Database, GripVertical, Lock, Move } from 'lucide-react'
import type { CodeNode, PageDoc } from '@jeffi/site-blocks'
import { insideData, nodeName, nodeWords, pathTo } from './nodes'

// The page as layers: its sections in order, each code section's elements as a tree. Drag a row to reorder it among
// its siblings (dnd-kit, pointer or keyboard); a section moves among the page's sections. Nodes that fill a slot (a
// branch shown on a condition, a list's item, a render function's body) stay where they are; what is inside them
// moves. Words and store data aren't rows: an element shows its words beside its name.

export interface LayersProps {
  doc: PageDoc
  trees: Record<string, CodeNode>
  /** `more`: the rest of a multiple selection, in the same section. */
  sel: { block: string; id: string | null; more?: string[] } | null
  canWrite: boolean
  label: (block: string) => string
  /** A section the page needs (a locked part inside, or a classic block the registry locks). */
  locked?: (block: string) => boolean
  /** `additive` (shift-click): adds or removes the element from the selection. */
  onSelect: (block: string, id: string | null, additive?: boolean) => void
  onMoveSection: (block: string, to: number) => void
  /** Before the child at `index` of `parent`, counted before the node leaves its place (design.ts `move`). */
  onMoveNode: (block: string, id: string, parent: string, index: number) => void
  /**
   * Whether an element is placed freely at the breakpoint being edited ('free'), only on a wider one and so in the flow
   * here ('wider'), could be ('flow'), or can't (null).
   */
  freeState?: (block: string, id: string) => 'free' | 'wider' | 'flow' | null
  onToggleFree?: (block: string, id: string) => void
  /** A free layer's rotation at the breakpoint being edited, in degrees (0 or unset: none). */
  rotation?: (block: string, id: string) => number
}

const shown = (n: CodeNode) => n.t !== 'text' && n.t !== 'expr' && !!n.id
const listOf = (n: CodeNode): CodeNode[] => (n.t === 'el' || n.t === 'cmp' || n.t === 'frag' ? n.children : [])
const slotsOf = (n: CodeNode): CodeNode[] =>
  n.t === 'cmp' && n.render ? [n.render.body] : n.t === 'cond' ? [n.then, ...(n.else ? [n.else] : [])] : n.t === 'each' ? [n.body] : []

/** dnd-kit's new place for a row, as design.ts counts it in the full child list (words included). */
export function moveIndex(all: CodeNode[], active: string, over: string): number | null {
  const from = all.findIndex(c => c.id === active)
  const to = all.findIndex(c => c.id === over)
  if (from < 0 || to < 0 || from === to) return null
  return to > from ? to + 1 : to
}

type Ctx = Omit<LayersProps, 'doc' | 'label' | 'locked' | 'onMoveSection'> & {
  open: Set<string>
  toggle: (k: string) => void
  sensors: SensorDescriptor<SensorOptions>[]
}
const LayersCtx = createContext<Ctx | null>(null)
const useLayers = () => useContext(LayersCtx)!

const rowCls = (on: boolean) =>
  `group flex min-w-0 items-center gap-1 rounded-md py-1 pr-1.5 text-left text-[13px] ${on ? 'bg-accent-50 text-accent-700' : 'text-foreground hover:bg-surface-secondary'}`

function Chevron({ open, hidden, onClick }: { open: boolean; hidden: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-label={open ? 'Collapse' : 'Expand'} aria-expanded={open} onClick={onClick} className={`shrink-0 text-foreground-muted ${hidden ? 'invisible' : ''}`}>
      <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
    </button>
  )
}

function Inside({ block, node, depth }: { block: string; node: CodeNode; depth: number }) {
  return (
    <>
      <NodeList block={block} parent={node} depth={depth} />
      {slotsOf(node)
        .filter(shown)
        .map(x => (
          <NodeRow key={x.id} block={block} node={x} depth={depth} sortable={false} />
        ))}
    </>
  )
}

function NodeRow({ block, node, depth, sortable }: { block: string; node: CodeNode; depth: number; sortable: boolean }) {
  const c = useLayers()
  const id = node.id!
  const k = `${block}:${id}`
  const open = c.open.has(k)
  const s = useSortable({ id, disabled: !sortable || !c.canWrite })
  const words = nodeWords(node, 26)
  const empty = !listOf(node).some(shown) && !slotsOf(node).some(shown)
  const free = c.freeState?.(block, id) ?? null
  const rotated = free === 'free' ? (c.rotation?.(block, id) ?? 0) : 0
  const picked = c.sel?.block === block && (c.sel.id === id || !!c.sel.more?.includes(id))
  // Named only when there is more to say than its text: a free layer, or a rotated one.
  const name = free === 'free' ? `${[nodeName(node), words].filter(Boolean).join(' ')}, free layer${rotated ? `, rotated ${rotated} degrees` : ''}` : undefined
  return (
    <div ref={s.setNodeRef} style={{ transform: CSS.Translate.toString(s.transform), transition: s.transition, opacity: s.isDragging ? 0.5 : 1 }}>
      <div className={rowCls(picked)} style={{ paddingLeft: 6 + depth * 12 }}>
        <Chevron open={open} hidden={empty} onClick={() => c.toggle(k)} />
        <button type="button" aria-label={name} onClick={e => c.onSelect(block, id, e.shiftKey)} className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-left">
          <span className="shrink-0 font-medium">{nodeName(node)}</span>
          {words && <span className="truncate text-xs text-foreground-muted">{words}</span>}
        </button>
        {'locked' in node && node.locked && <Lock aria-label="Needed on the page" className="h-3 w-3 shrink-0 text-foreground-muted" />}
        {insideData(c.trees[block], id) && <Database aria-label="Drawn from store data" className="h-3 w-3 shrink-0 text-foreground-muted" />}
        {free && c.onToggleFree && (
          <button
            type="button"
            aria-label="Free placement"
            aria-pressed={free === 'free'}
            disabled={!c.canWrite}
            title={
              free === 'free'
                ? 'Placed freely on this screen size: click to put it back in the flow'
                : free === 'wider'
                  ? 'Placed freely on a wider screen; here it sits in the flow. Click to place it on this screen size too'
                  : 'Place it anywhere in its section on this screen size'
            }
            onClick={() => c.onToggleFree?.(block, id)}
            className={`shrink-0 rounded p-0.5 ${free === 'free' ? 'text-accent-600' : free === 'wider' ? 'text-accent-400' : 'text-foreground-muted opacity-0 group-hover:opacity-100 focus:opacity-100'}`}
          >
            <Move className="h-3 w-3" />
          </button>
        )}
        {sortable && c.canWrite && (
          <span {...s.attributes} {...s.listeners} aria-label={`Drag ${nodeName(node)}`} className="shrink-0 cursor-grab text-foreground-muted opacity-0 group-hover:opacity-100 focus:opacity-100">
            <GripVertical className="h-3.5 w-3.5" />
          </span>
        )}
      </div>
      {open && <Inside block={block} node={node} depth={depth + 1} />}
    </div>
  )
}

function NodeList({ block, parent, depth }: { block: string; parent: CodeNode; depth: number }) {
  const c = useLayers()
  const all = listOf(parent)
  const nodes = all.filter(shown)
  if (!nodes.length) return null
  const onDragEnd = (e: DragEndEvent) => {
    const index = e.over ? moveIndex(all, String(e.active.id), String(e.over.id)) : null
    if (index !== null && parent.id) c.onMoveNode(block, String(e.active.id), parent.id, index)
  }
  return (
    <DndContext sensors={c.sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={nodes.map(n => n.id!)} strategy={verticalListSortingStrategy}>
        {nodes.map(n => (
          <NodeRow key={n.id} block={block} node={n} depth={depth} sortable />
        ))}
      </SortableContext>
    </DndContext>
  )
}

function SectionRow({ id, label, locked }: { id: string; label: string; locked: boolean }) {
  const c = useLayers()
  const s = useSortable({ id, disabled: !c.canWrite })
  const tree = c.trees[id]
  const k = `s:${id}`
  const open = c.open.has(k)
  return (
    <div ref={s.setNodeRef} style={{ transform: CSS.Translate.toString(s.transform), transition: s.transition, opacity: s.isDragging ? 0.5 : 1 }}>
      <div className={rowCls(c.sel?.block === id && (!c.sel.id || c.sel.id === tree?.id))} style={{ paddingLeft: 4 }}>
        <Chevron open={open} hidden={!tree} onClick={() => c.toggle(k)} />
        <button type="button" onClick={() => c.onSelect(id, tree?.id ?? null)} className="min-w-0 flex-1 truncate text-left font-semibold">
          {label}
        </button>
        {/* A classic block is one unit: it moves and goes as a whole, and its fields open on the right. */}
        {!tree && <span className="shrink-0 rounded border border-border-default px-1 text-[10px] font-medium uppercase tracking-wide text-foreground-muted">Classic</span>}
        {locked && <Lock aria-label="The page needs this section" className="h-3 w-3 shrink-0 text-foreground-muted" />}
        {c.canWrite && (
          <span {...s.attributes} {...s.listeners} aria-label={`Drag ${label}`} className="shrink-0 cursor-grab text-foreground-muted opacity-0 group-hover:opacity-100 focus:opacity-100">
            <GripVertical className="h-3.5 w-3.5" />
          </span>
        )}
      </div>
      {open && tree && <Inside block={id} node={tree} depth={1} />}
    </div>
  )
}

export default function Layers({ doc, label, locked, onMoveSection, ...rest }: LayersProps) {
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const { sel, trees } = rest

  // The selection's section and the elements above it open, so the selected row shows.
  useEffect(() => {
    if (!sel) return
    const tree = trees[sel.block]
    const keys = [`s:${sel.block}`, ...(tree && sel.id ? pathTo(tree, sel.id).filter(n => n.id !== sel.id).map(n => `${sel.block}:${n.id}`) : [])]
    setOpen(o => (keys.every(k => o.has(k)) ? o : new Set([...o, ...keys])))
  }, [sel, trees])

  const toggle = (k: string) => setOpen(o => (o.has(k) ? new Set([...o].filter(x => x !== k)) : new Set([...o, k])))
  const onSectionsEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    const to = doc.order.indexOf(String(e.over.id))
    if (to >= 0) onMoveSection(String(e.active.id), to)
  }

  return (
    <LayersCtx.Provider value={{ ...rest, open, toggle, sensors }}>
      <nav aria-label="Layers" className="space-y-0.5">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onSectionsEnd}>
          <SortableContext items={doc.order} strategy={verticalListSortingStrategy}>
            {doc.order.map(id => (
              <SectionRow key={id} id={id} label={label(id)} locked={!!locked?.(id)} />
            ))}
          </SortableContext>
        </DndContext>
      </nav>
    </LayersCtx.Provider>
  )
}
