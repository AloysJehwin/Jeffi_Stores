'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Copy, Monitor, Move, Plus, Redo2, Rocket, Smartphone, Tablet, Trash2, Undo2, Wand2, X } from 'lucide-react'
import { DEFAULT_THEME, insertBlock, isTagNode, moveBlock, removeBlock, updateBlock, type Block, type CodeNode } from '@jeffi/site-blocks'
import { DesignError, findNode, freshId, treeIds, type Breakpoint, type DesignOp } from '@jeffi/site-blocks/design'
import { classOps, setPanelValue, type PanelProp } from '@/lib/site/code/classes'
import type { SiteEditorHost } from './host'
import Inspector from './Inspector'
import Layers from './Layers'
import FreePanel from './FreePanel'
import AiBox from './AiBox'
import CritiquePanel from './CritiquePanel'
import { critiqueTrees, type TreeFinding } from '@/lib/site/code/tree-critique'
import { isConvertible } from '@/lib/site/convertible'
import { canFree, layerAt, placeOps, placedWider, restackOps, unplaceOps } from './free-ops'
import type { FreeRect } from '@/lib/site/code/free'
import { hasLocked, insertPlace, litProp, nodeName, nodeWords, newNode, newSectionTree, parentOf, type NewKind } from './nodes'
import StylePanel, { BREAKPOINT_NAME } from './StylePanel'
import { addCredit, adoptSaved, canRedo, canUndo, createEditor, currentTrees, docToSave, editDoc, editSection, endGestures, liveTree, redo, undo, type EditorState, type Shown } from './state'

// The visual site editor (docs/plans/SITE_EDITOR_PLAN.md, phase 2): the real page on a canvas (an iframe with a
// preview token, where components/visitor/site/editor/SiteEditorBridge selects and edits in place), the page's
// sections on the left, the selected element on the right. Every change is a design operation recorded in one
// history (state.ts) and autosaved through the host; the server compiles what it saves, so the canvas reloads only
// for changes it can't show by itself.

const P = 'site-editor:'
const CODE_SECTION = 'code_section'
const SAVE_AFTER_MS = 800
/** The canvas per breakpoint (Tailwind's base, md and lg). */
const WIDTH: Partial<Record<Breakpoint, number>> = { base: 390, md: 768, lg: 1280 }
const BREAKPOINTS = [
  ['base', Smartphone],
  ['md', Tablet],
  ['lg', Monitor],
] as const

type Selection = { block: string; id: string | null } | null
/** The canvas's answer to `measure`: the element's box in % of its frame, the frame's node id and height in px. */
type Measured = { rect: Required<FreeRect> | null; frame: string | null; frameHeight: number | null }
type Status = { kind: 'idle' | 'pending' | 'saving' | 'saved' } | { kind: 'error'; message: string }

export default function SiteEditor({ host }: { host: SiteEditorHost }) {
  const [state, setState] = useState<EditorState | null>(null)
  const [failed, setFailed] = useState(false)
  const [sel, setSel] = useState<Selection>(null)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [frameKey, setFrameKey] = useState(0)
  const [scale, setScale] = useState(1)
  const [bp, setBp] = useState<Breakpoint>('lg')
  const width = WIDTH[bp] ?? 1280
  const frame = useRef<HTMLIFrameElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const hostRef = useRef(host)
  hostRef.current = host
  // The latest state and selection, for message handlers and chained saves (updated before React re-renders).
  const latest = useRef<{ state: EditorState | null; sel: Selection }>({ state, sel })
  latest.current.sel = sel
  const saved = useRef<{ rev: number; reloadAt: number | null; chain: Promise<void> }>({ rev: 0, reloadAt: null, chain: Promise.resolve() })
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const scrollY = useRef(0)
  const seq = useRef({ n: 0, sent: new Map<number, number>() })
  const measures = useRef({ n: 0, wait: new Map<number, (m: Measured | null) => void>() })
  const [aiBusy, setAiBusy] = useState(false)
  const [checking, setChecking] = useState(false)
  const [converting, setConverting] = useState(false)
  /** Counts selections, so field edits join one undo step only within one visit to a block. */
  const fieldsRun = useRef(0)
  /** Elements an AI change touched, lit up on the canvas once it reloads. */
  const flash = useRef<{ block: string; ids: string[] } | null>(null)

  useEffect(() => {
    let stop = false
    hostRef.current.load().then(doc => {
      if (stop) return
      if (!doc) return setFailed(true)
      const s = createEditor(doc)
      latest.current.state = s
      setState(s)
    })
    return () => {
      stop = true
    }
  }, [])

  const post = useCallback((m: Record<string, unknown>) => frame.current?.contentWindow?.postMessage({ ...m, type: P + m.type }, '*'), [])
  const requestReload = () => (saved.current.reloadAt = latest.current.state?.rev ?? 0)
  const applyOnCanvas = (block: string, ops: DesignOp[]) => {
    const n = ++seq.current.n
    seq.current.sent.set(n, ops.length)
    post({ type: 'apply', block, ops, seq: n })
  }

  /** A new state from the latest one; a DesignError shows in the toolbar and changes nothing. */
  const update = useCallback((fn: (s: EditorState) => EditorState): EditorState | null => {
    const s = latest.current.state
    if (!s) return null
    try {
      const next = fn(s)
      if (next !== s) {
        latest.current.state = next
        setState(next)
      }
      return next
    } catch (e) {
      if (!(e instanceof DesignError)) throw e
      setStatus({ kind: 'error', message: e.message })
      return null
    }
  }, [])

  // ── Saving ─────────────────────────────────────────────────────────────────────────────────────
  const saveOnce = useCallback(async () => {
    const s0 = latest.current.state
    if (!s0 || s0.rev === saved.current.rev) return
    setStatus({ kind: 'saving' })
    const sent = currentTrees(s0)
    const rev = s0.rev
    const r = await hostRef.current.save(docToSave(s0)).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : 'Could not save' }))
    if (!r.ok) return setStatus({ kind: 'error', message: r.error })
    saved.current.rev = rev
    const cur = latest.current.state ?? s0
    const next = adoptSaved(cur, sent, r.doc)
    let reload = saved.current.reloadAt !== null && saved.current.reloadAt <= rev
    if (next !== cur) {
      latest.current.state = next
      setState(next)
      reload = true
    }
    if (reload) {
      saved.current.reloadAt = null
      setFrameKey(k => k + 1)
    }
    setStatus({ kind: latest.current.state?.rev === rev ? 'saved' : 'pending' })
  }, [])
  const flush = useCallback(() => (saved.current.chain = saved.current.chain.then(saveOnce)), [saveOnce])

  useEffect(() => {
    if (!state || state.rev === saved.current.rev) return
    setStatus(s => (s.kind === 'saving' ? s : { kind: 'pending' }))
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(), SAVE_AFTER_MS)
  }, [state, flush])
  useEffect(() => () => clearTimeout(timer.current), [])

  const flushNow = async () => {
    clearTimeout(timer.current)
    await flush()
  }

  // ── Editing ────────────────────────────────────────────────────────────────────────────────────
  const edit = (block: string, ops: DesignOp[], gesture?: string): boolean => {
    if (!update(s => editSection(s, block, ops, gesture))) return false
    applyOnCanvas(block, ops)
    return true
  }
  const treeAt = (block: string) => liveTree(latest.current.state, block)
  const say = (message: string) => setStatus({ kind: 'error', message })

  // ── Elements and sections: add, duplicate, delete (parts the page needs stay; design.ts refuses them too) ──
  const addNode = (block: string, kind: NewKind) => {
    const tree = treeAt(block)
    const place = tree && insertPlace(tree, latest.current.sel?.block === block ? latest.current.sel.id : null)
    if (!tree || !place) return say('Select an element beside where the new one should go')
    const id = freshId(treeIds(tree))
    if (!edit(block, [{ op: 'insert', parent: place.parent, index: place.index, node: newNode(kind, id) }])) return
    requestReload()
    select(block, id)
  }
  const duplicateNode = (block: string, id: string) => {
    const tree = treeAt(block)
    const node = tree && findNode(tree, id)?.node
    if (!tree || !node) return
    const as = isTagNode(node) ? freshId(treeIds(tree)) : undefined
    if (!edit(block, [{ op: 'duplicate', id, ...(as ? { as } : {}) }])) return
    requestReload()
    if (as) select(block, as)
  }
  const deleteNode = (block: string, id: string) => {
    const tree = treeAt(block)
    if (!tree || id === tree.id) return
    const up = parentOf(tree, id)?.parent.id ?? tree.id ?? null
    if (!edit(block, [{ op: 'remove', id }])) return
    requestReload()
    select(block, up)
  }
  const sectionLocked = (id: string) => {
    const tree = treeAt(id)
    return tree ? hasLocked(tree) : !!hostRef.current.blockLocked?.(latest.current.state?.doc.blocks[id]?.type ?? '')
  }
  const changePage = (fn: (s: EditorState) => EditorState, then?: () => void) => {
    if (!update(fn)) return
    requestReload()
    then?.()
  }
  const addSection = () => {
    const doc = latest.current.state?.doc
    if (!doc) return
    const at = latest.current.sel ? doc.order.indexOf(latest.current.sel.block) + 1 || doc.order.length : doc.order.length
    const id = crypto.randomUUID()
    const v = Object.values(doc.blocks).find(b => b.type === CODE_SECTION)?.v ?? 1
    const tree = newSectionTree()
    changePage(
      s => editDoc(s, d => insertBlock(d, { id, type: CODE_SECTION, v, props: { label: 'New section', source: '', tree, compiled: null } }, at)),
      () => select(id, tree.id ?? null)
    )
  }
  const duplicateSection = (id: string) => {
    if (sectionLocked(id)) return say('This section holds a part a page has only once')
    const copy = crypto.randomUUID()
    changePage(
      s =>
        editDoc(s, d => {
          const b = d.blocks[id]
          const tree = liveTree(s, id)
          const name = typeof b.props.label === 'string' && b.props.label ? b.props.label : 'Section'
          const props = tree ? { ...structuredClone(b.props), label: `${name} (copy)`.slice(0, 80), tree: structuredClone(tree), source: '' } : structuredClone(b.props)
          return insertBlock(d, { ...structuredClone(b), id: copy, children: undefined, props }, d.order.indexOf(id) + 1)
        }),
      () => select(copy, treeAt(copy)?.id ?? null)
    )
  }
  const deleteSection = (id: string) => {
    const doc = latest.current.state?.doc
    if (!doc) return
    if (sectionLocked(id)) return say('The page needs this section to work')
    if (doc.order.length <= 1) return say('A page keeps at least one section')
    changePage(
      s => editDoc(s, d => removeBlock(d, id)),
      () => setSel(null)
    )
  }
  /** A classic block's fields from the host's form: typing in one block stays one undo step until something else changes. */
  const classicFields = (id: string, next: Block) => {
    const cur = latest.current.state?.doc.blocks[id]
    if (!hostRef.current.canWrite || !cur || cur.type !== next.type || treeAt(id)) return
    changePage(s => editDoc(s, d => updateBlock(d, id, { props: next.props, visibility: next.visibility }), `fields:${id}:${fieldsRun.current}`))
  }
  /** A classic content block rewritten as a code section in its place (one undoable step), then selected. */
  const convertSection = async (id: string) => {
    const convert = hostRef.current.convertBlock
    if (!convert || converting) return
    setConverting(true)
    try {
      // The block as saved is what is converted (a Showcase converts its saved page).
      await flushNow()
      const b = latest.current.state?.doc.blocks[id]
      if (!b) return
      const r = await convert(b).catch(() => ({ ok: false as const, error: 'Could not convert this section' }))
      if (!r.ok) return say(r.error)
      const now = latest.current.state?.doc.blocks[id]
      if (now?.type !== b.type) return
      const { type, v, props, visibility } = r.block
      changePage(
        s => editDoc(s, d => updateBlock(d, id, { type, v, props, visibility })),
        () => select(id, treeAt(id)?.id ?? null)
      )
    } finally {
      setConverting(false)
    }
  }
  const show = (shown: Shown) => {
    if (shown === 'reload') requestReload()
    else if (shown) applyOnCanvas(shown.block, shown.ops)
  }
  const step = (dir: 'undo' | 'redo') => {
    const s = latest.current.state
    if (!s || !hostRef.current.canWrite) return
    const r = dir === 'undo' ? undo(s) : redo(s)
    if (r.state === s) return
    latest.current.state = r.state
    setState(r.state)
    show(r.shown)
  }
  /** A style property at the breakpoint being edited, as per-breakpoint class operations. New classes need the
   * section's CSS compiled again, so the canvas reloads after the save. */
  // ── AI ──
  /** The section changed as asked, focused on the selection, as one undoable step; what it touched lights up. */
  const changeWithAi = async (block: string, id: string | null, instruction: string) => {
    const ask = hostRef.current.changeWithAi
    if (!ask || aiBusy) return
    setAiBusy(true)
    try {
      // The saved section is what the AI changes (a Showcase charges and saves on the server).
      await flushNow()
      const tree = treeAt(block)
      const b = latest.current.state?.doc.blocks[block]
      if (!tree || !b) return
      const r = await ask({ block, label: (typeof b.props.label === 'string' && b.props.label) || 'Section', tree, ids: id ? [id] : [], instruction })
      if (!r.ok) return say(r.error)
      if (!update(s => editSection(s, block, [{ op: 'replace', tree: r.tree }]))) return
      flash.current = { block, ids: r.changed }
      requestReload()
      setStatus({ kind: 'pending' })
    } finally {
      setAiBusy(false)
    }
  }

  /** A cheap action's words written into the element, as one step. */
  const elementText = async (block: string, fieldId: string, text: string, action: 'rewrite' | 'shorten' | 'translate', language?: string) => {
    const ask = hostRef.current.elementAi
    if (!ask || aiBusy) return
    setAiBusy(true)
    try {
      const r = await ask({ kind: 'text', action, text, language, context: label(block) })
      if (!r.ok) return say(r.error)
      if (r.text) edit(block, [{ op: 'text', id: fieldId, value: r.text }])
    } finally {
      setAiBusy(false)
    }
  }
  /** A picture for an image slot (its shape, what it shows), its description when it had none, its credit kept. */
  const elementPicture = async (block: string, id: string) => {
    const ask = hostRef.current.elementAi
    const tree = treeAt(block)
    const node = tree && findNode(tree, id)?.node
    if (!ask || aiBusy || !tree || !node) return
    const alt = litProp(node, 'alt') ?? ''
    setAiBusy(true)
    try {
      const r = await ask({ kind: 'picture', subject: alt || nodeWords(tree, 80) || label(block), aspect: litProp(node, 'aspect') })
      if (!r.ok) return say(r.error)
      if (!r.url) return
      const ops: DesignOp[] = [{ op: 'attr', id, name: 'src', value: r.url }]
      if (!alt && r.alt && litProp(node, 'alt') !== null) ops.push({ op: 'attr', id, name: 'alt', value: r.alt.slice(0, 200) })
      if (edit(block, ops) && r.credit) update(s => addCredit(s, r.url!, r.credit))
    } finally {
      setAiBusy(false)
    }
  }

  // ── Free layers ──
  /** An element's box in % of its frame, as the canvas measures it. */
  const measure = (block: string, id: string) =>
    new Promise<Measured | null>(resolve => {
      const req = ++measures.current.n
      const done = (m: Measured | null) => (measures.current.wait.delete(req), resolve(m))
      measures.current.wait.set(req, done)
      post({ type: 'measure', block, id, req })
      setTimeout(() => done(null), 2000)
    })
  /** In the flow at this breakpoint: placed where it sits now, on top of the section's other layers. Placed: back. */
  const toggleFree = async (block: string, id: string) => {
    const tree = treeAt(block)
    if (!tree || !canFree(tree, id)) return
    if (layerAt(tree, id, bp)) {
      if (edit(block, unplaceOps(tree, id, bp))) post({ type: 'place', block, id, rect: null })
      return requestReload()
    }
    const m = await measure(block, id)
    if (!m?.rect) return say('Show that element on the canvas first (it may be hidden at this screen size)')
    const rect: FreeRect = { left: Math.round(m.rect.left), top: Math.round(m.rect.top), width: Math.round(m.rect.width) }
    const now = treeAt(block)
    if (!now || !update(s => editSection(s, block, placeOps(now, id, bp, rect, { frame: m.frame, frameHeight: m.frameHeight })))) return
    post({ type: 'place', block, id, rect, frame: m.frame, frameMinHeight: m.frameHeight })
    requestReload()
    select(block, id)
  }
  /** A free layer's new place, typed or dragged (`shown`: the canvas already shows it). */
  const placeLayer = (block: string, id: string, rect: FreeRect, shown = false) => {
    const tree = treeAt(block)
    if (!tree) return
    const ops = placeOps(tree, id, bp, rect)
    if (!ops.length || !update(s => editSection(s, block, ops))) return
    if (!shown) post({ type: 'place', block, id, rect })
    requestReload()
  }
  const restackLayer = (block: string, id: string, dir: 'front' | 'back' | 'forward' | 'backward') => {
    const tree = treeAt(block)
    if (!tree) return
    if (edit(block, restackOps(tree, id, bp, dir))) requestReload()
  }

  const style = (block: string, id: string, prop: PanelProp, value: string | null) => {
    const node = findNode(liveTree(latest.current.state, block) ?? { t: 'frag', children: [] }, id)?.node
    if (!node || !isTagNode(node)) return
    const cls = node.props.className
    const before = cls && cls.k === 'lit' && typeof cls.v === 'string' ? cls.v : ''
    const ops = classOps(id, before, setPanelValue(before, bp, prop, value))
    if (!ops.length) return
    edit(block, ops)
    requestReload()
  }
  const select = (block: string, id: string | null) => {
    setSel({ block, id })
    post({ type: 'select', block, id })
  }

  // ── The canvas ─────────────────────────────────────────────────────────────────────────────────
  const handlers = useRef<(m: Record<string, unknown>) => void>(() => {})
  handlers.current = m => {
    const kind = String(m.type).slice(P.length)
    if (kind === 'ready') {
      post({ type: 'mode', on: true, write: hostRef.current.canWrite })
      const at = latest.current.sel
      if (at) post({ type: 'select', block: at.block, id: at.id })
      if (scrollY.current) post({ type: 'scroll-to', y: scrollY.current })
      if (flash.current) {
        post({ type: 'flash', ...flash.current })
        flash.current = null
      }
    } else if (kind === 'select' && typeof m.block === 'string') setSel({ block: m.block, id: typeof m.id === 'string' ? m.id : null })
    else if (kind === 'ops' && typeof m.block === 'string' && Array.isArray(m.ops)) {
      // Typed in place: the canvas shows it already. Refused (it changed since), the reload puts the page right.
      if (!hostRef.current.canWrite || !update(s => editSection(s, m.block as string, m.ops as DesignOp[]))) setFrameKey(k => k + 1)
    } else if (kind === 'applied' && typeof m.seq === 'number') {
      const want = seq.current.sent.get(m.seq)
      seq.current.sent.delete(m.seq)
      if (want !== undefined && (!Array.isArray(m.ops) || m.ops.length < want)) requestReload()
    } else if (kind === 'scroll' && typeof m.y === 'number') scrollY.current = m.y
    else if (kind === 'measured' && typeof m.req === 'number') measures.current.wait.get(m.req)?.(m as unknown as Measured)
    else if (kind === 'placed' && typeof m.block === 'string' && typeof m.id === 'string' && m.rect && typeof m.rect === 'object' && hostRef.current.canWrite) {
      // Dragged on the canvas: its height counts once resized, or when it already had one.
      const r = m.rect as Required<FreeRect>
      const tree = treeAt(m.block)
      const had = tree ? layerAt(tree, m.id, bp)?.rect.height !== undefined : false
      placeLayer(m.block, m.id, { left: r.left, top: r.top, width: r.width, ...(m.sized || had ? { height: r.height } : {}) }, true)
    }
    else if (kind === 'key') {
      if (m.action === 'undo' || m.action === 'redo') step(m.action)
      if (m.action === 'escape') setSel(null)
      const at = latest.current.sel
      if (m.action === 'delete' && at && hostRef.current.canWrite) {
        if (at.id) deleteNode(at.block, at.id)
        // A classic block is one piece: Delete takes it whole (undoable), unless the page needs it.
        else if (!treeAt(at.block)) deleteSection(at.block)
      }
    }
  }
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow || typeof e.data?.type !== 'string' || !e.data.type.startsWith(P)) return
      handlers.current(e.data)
    }
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t?.closest('input, textarea, select, [contenteditable]')) return
      const mod = e.metaKey || e.ctrlKey
      if (!mod && (e.key === 'Delete' || e.key === 'Backspace') && t?.closest('[data-site-editor]')) {
        e.preventDefault()
        return handlers.current({ type: `${P}key`, action: 'delete' })
      }
      if (!mod) return
      const k = e.key.toLowerCase()
      if (k === 'z' || k === 'y') {
        e.preventDefault()
        handlers.current({ type: `${P}key`, action: k === 'y' || e.shiftKey ? 'redo' : 'undo' })
      }
    }
    window.addEventListener('message', onMessage)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('message', onMessage)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  useEffect(() => {
    fieldsRun.current++
  }, [sel?.block, sel?.id])

  const ready = !!state
  const trees = useMemo(() => (state ? currentTrees(state) : {}), [state])
  // The page checked in reading order (contrast, lengths, picture descriptions, headings, free layers).
  const findings = useMemo(() => {
    if (!state) return []
    const name = (id: string) => String(state.doc.blocks[id]?.props?.label || 'Section')
    return critiqueTrees(state.doc.order.filter(id => trees[id]).map(id => ({ block: id, label: name(id), tree: trees[id] })), host.theme ?? DEFAULT_THEME)
  }, [state, trees, host.theme])
  const fixFinding = (f: TreeFinding) => {
    if (!f.fix) return
    if ('shorten' in f.fix) return void elementText(f.block, f.fix.shorten.fieldId, f.fix.shorten.text, 'shorten')
    if (edit(f.block, f.fix.ops)) requestReload()
  }
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ready, width])

  // ── Render ─────────────────────────────────────────────────────────────────────────────────────
  if (failed) return <p className="rounded-xl border border-border-default bg-surface-elevated p-5 text-sm text-foreground-muted">This page could not be opened in the visual editor.</p>
  if (!state) return <p className="rounded-xl border border-border-default bg-surface-elevated p-5 text-sm text-foreground-muted">Opening the visual editor…</p>

  const { doc } = state
  const block = sel ? doc.blocks[sel.block] : undefined
  const tree = sel ? liveTree(state, sel.block) : null
  const label = (id: string) => {
    const b = doc.blocks[id]
    return (typeof b?.props?.label === 'string' && b.props.label) || hostRef.current.blockLabel?.(b?.type ?? '') || b?.type || 'Block'
  }
  const iconBtn = 'p-1.5 rounded-md border border-border-default text-foreground-muted hover:text-foreground disabled:opacity-40'
  const smallBtn = 'inline-flex items-center gap-1 rounded-md border border-border-default px-2 h-7 text-xs text-foreground-secondary hover:text-foreground disabled:opacity-40'
  const statusText = status.kind === 'pending' ? 'Unsaved changes…' : status.kind === 'saving' ? 'Saving…' : status.kind === 'saved' ? 'Saved to draft' : status.kind === 'error' ? status.message : ''
  const busy = status.kind === 'pending' || status.kind === 'saving'

  return (
    <div className="space-y-3" data-site-editor="">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border-default bg-surface-elevated p-2">
        <p className="px-1 text-sm font-semibold text-foreground">{host.title}</p>
        <span className="rounded-full bg-accent-50 px-2 py-0.5 text-[11px] font-medium text-accent-600">Visual editor · beta</span>
        <div className="flex gap-1">
          <button type="button" className={iconBtn} disabled={!host.canWrite || !canUndo(state)} onClick={() => step('undo')} aria-label="Undo" title="Undo (⌘Z)">
            <Undo2 className="w-4 h-4" />
          </button>
          <button type="button" className={iconBtn} disabled={!host.canWrite || !canRedo(state)} onClick={() => step('redo')} aria-label="Redo" title="Redo (⇧⌘Z)">
            <Redo2 className="w-4 h-4" />
          </button>
        </div>
        <div className="flex gap-0.5 rounded-lg border border-border-default p-0.5" role="group" aria-label="Screen size">
          {BREAKPOINTS.map(([b, Icon]) => (
            <button
              key={b}
              type="button"
              onClick={() => setBp(b)}
              aria-pressed={bp === b}
              title={`${BREAKPOINT_NAME[b]} (${WIDTH[b]}px): styles you set apply from this size up`}
              className={`inline-flex items-center gap-1 rounded-md px-2 h-7 text-xs font-medium ${bp === b ? 'bg-accent-500 text-white' : 'text-foreground-muted hover:text-foreground'}`}
            >
              <Icon className="h-3.5 w-3.5" /> {BREAKPOINT_NAME[b]}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setChecking(c => !c)}
          aria-pressed={checking}
          className={`inline-flex items-center gap-1 rounded-lg border px-2.5 h-8 text-xs font-medium ${checking ? 'border-accent-500 text-accent-600' : 'border-border-default text-foreground-secondary hover:text-foreground'}`}
        >
          Check page{findings.length ? ` · ${findings.length}` : ''}
        </button>
        <span role="status" className={`text-xs ${status.kind === 'error' ? 'text-red-600' : 'text-foreground-muted'}`}>
          {statusText}
        </span>
        <div className="ml-auto flex gap-2">
          {host.onClose && (
            <button
              type="button"
              onClick={async () => (await flushNow(), hostRef.current.onClose?.())}
              className="inline-flex items-center gap-1.5 px-3 h-9 text-sm rounded-lg border border-border-default text-foreground-secondary"
            >
              <X className="w-4 h-4" /> Forms editor
            </button>
          )}
          {host.publish && host.canWrite && (
            <button
              type="button"
              disabled={busy || status.kind === 'error'}
              title={busy ? 'Saving your last change…' : undefined}
              onClick={async () => (await flushNow(), await hostRef.current.publish?.())}
              className="inline-flex items-center gap-1.5 px-3 h-9 text-sm font-medium rounded-lg bg-accent-500 text-white disabled:opacity-50"
            >
              <Rocket className="w-4 h-4" /> Publish
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[240px_minmax(0,1fr)_320px] gap-3 items-start xl:items-stretch xl:h-[calc(100dvh-8.5rem)] xl:min-h-[34rem]">
        <aside className="rounded-xl border border-border-default bg-surface-elevated p-3 space-y-1 min-w-0 xl:min-h-0 xl:overflow-y-auto [scrollbar-width:thin]">
          <p className="pb-1 text-xs font-semibold uppercase tracking-wide text-foreground-muted">Layers</p>
          <Layers
            doc={doc}
            trees={trees}
            sel={sel}
            canWrite={host.canWrite}
            label={label}
            locked={sectionLocked}
            onSelect={select}
            onMoveSection={(id, to) => {
              if (update(s => editDoc(s, d => moveBlock(d, id, to)))) requestReload()
            }}
            onMoveNode={(id, node, parent, index) => {
              edit(id, [{ op: 'move', id: node, parent, index }])
              requestReload()
            }}
            freeState={(block, id) => {
              const tree = trees[block]
              return !tree || !canFree(tree, id) ? null : layerAt(tree, id, bp) ? 'free' : placedWider(tree, id, bp) ? 'wider' : 'flow'
            }}
            onToggleFree={(block, id) => void toggleFree(block, id)}
          />
        </aside>

        <div ref={box} className="relative min-w-0 overflow-hidden rounded-xl border border-border-default bg-surface-secondary xl:min-h-0">
          {host.previewUrl ? (
            <div className="flex h-[760px] justify-center overflow-hidden xl:h-full">
              <iframe
                key={frameKey}
                ref={frame}
                title="Page canvas"
                src={host.previewUrl}
                style={{ flexShrink: 0, width, height: `${100 / scale}%`, transform: `scale(${scale})`, transformOrigin: 'top center', border: 0, background: 'white' }}
              />
            </div>
          ) : (
            <p className="p-6 text-sm text-foreground-muted">Loading the canvas…</p>
          )}
        </div>

        <aside className="rounded-xl border border-border-default bg-surface-elevated p-3 space-y-4 min-w-0 xl:min-h-0 xl:overflow-y-auto [scrollbar-width:thin]">
          {checking && (
            <div className="space-y-2 border-b border-border-default pb-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Check page</p>
              <CritiquePanel
                findings={findings}
                canWrite={host.canWrite}
                canShorten={!!host.elementAi}
                busy={aiBusy}
                onShow={f => select(f.block, f.id)}
                onFix={fixFinding}
              />
            </div>
          )}
          {block && host.canWrite && (
            <div className="space-y-2 border-b border-border-default pb-3">
              <p className="truncate text-xs font-semibold uppercase tracking-wide text-foreground-muted">Section · {label(block.id)}</p>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" className={smallBtn} onClick={addSection}>
                  <Plus className="h-3.5 w-3.5" /> Add section after
                </button>
                <button type="button" className={smallBtn} aria-label="Duplicate section" disabled={sectionLocked(block.id)} onClick={() => duplicateSection(block.id)}>
                  <Copy className="h-3.5 w-3.5" /> Duplicate
                </button>
                <button type="button" className={smallBtn} aria-label="Delete section" disabled={sectionLocked(block.id) || doc.order.length <= 1} onClick={() => deleteSection(block.id)}>
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </button>
              </div>
              {!tree && host.convertBlock && isConvertible(block.type) && (
                <button type="button" className={smallBtn} disabled={converting || busy} onClick={() => void convertSection(block.id)}>
                  <Wand2 className="h-3.5 w-3.5" /> {converting ? 'Converting…' : 'Convert to editable section'}
                </button>
              )}
            </div>
          )}
          {sel && tree && host.changeWithAi && host.canWrite && (
            <AiBox
              key={`${sel.block}:${sel.id ?? ''}`}
              target={sel.id && sel.id !== tree.id ? nodeName(findNode(tree, sel.id)?.node ?? tree) : 'this section'}
              note={host.aiNote}
              busy={aiBusy}
              onAsk={instruction => void changeWithAi(sel.block, sel.id, instruction)}
            />
          )}
          {sel && tree && sel.id ? (
            <Inspector
              key={`${sel.block}:${sel.id}`}
              tree={tree}
              id={sel.id}
              canWrite={host.canWrite}
              onSelect={id => select(sel.block, id)}
              onText={(id, value) => edit(sel.block, [{ op: 'text', id, value }], `text:${id}`)}
              onDone={() => update(endGestures)}
              onAttr={(id, name, value) => edit(sel.block, [{ op: 'attr', id, name, value }])}
              onAdd={kind => addNode(sel.block, kind)}
              onDuplicate={() => duplicateNode(sel.block, sel.id!)}
              onDelete={() => deleteNode(sel.block, sel.id!)}
              renderImagePicker={host.renderImagePicker}
              ai={
                host.elementAi
                  ? {
                      busy: aiBusy,
                      text: (fieldId, current, action, language) => void elementText(sel.block, fieldId, current, action, language),
                      picture: () => void elementPicture(sel.block, sel.id!),
                    }
                  : undefined
              }
            >
              {layerAt(tree, sel.id, bp) && (
                <FreePanel
                  key={`${bp}:${JSON.stringify(layerAt(tree, sel.id, bp))}`}
                  layer={layerAt(tree, sel.id, bp)!}
                  bp={bp}
                  canWrite={host.canWrite}
                  onRect={rect => placeLayer(sel.block, sel.id!, rect)}
                  onRestack={dir => restackLayer(sel.block, sel.id!, dir)}
                  onFlow={() => void toggleFree(sel.block, sel.id!)}
                />
              )}
              {!layerAt(tree, sel.id, bp) && canFree(tree, sel.id) && (
                <div className="space-y-1.5">
                  {placedWider(tree, sel.id, bp) && (
                    <p className="text-[11px] text-foreground-muted">
                      Placed freely on {BREAKPOINT_NAME[placedWider(tree, sel.id, bp)!]}; on {BREAKPOINT_NAME[bp]} it sits in the flow at its place in the page.
                    </p>
                  )}
                  {host.canWrite && (
                    <button type="button" className={smallBtn} onClick={() => void toggleFree(sel.block, sel.id!)} title="Place it anywhere in its section on this screen size; narrower screens keep it in the flow">
                      <Move className="h-3.5 w-3.5" /> {placedWider(tree, sel.id, bp) ? `Place on ${BREAKPOINT_NAME[bp]} too` : 'Free placement'}
                    </button>
                  )}
                </div>
              )}
              {styleable(tree, sel.id) !== null && (
                <StylePanel key={bp} className={styleable(tree, sel.id) ?? ''} bp={bp} theme={host.theme} canWrite={host.canWrite} onChange={(prop, value) => style(sel.block, sel.id!, prop, value)} />
              )}
            </Inspector>
          ) : block && !tree ? (
            <div className="space-y-3">
              <p className="text-xs text-foreground-muted">
                A classic block: it moves and goes as one piece{host.renderBlockFields ? ', and its fields are below' : ''}.{' '}
                {host.convertBlock && isConvertible(block.type) ? 'Convert it to edit it on the page.' : 'Designing the page again with AI makes it editable on the page.'}
              </p>
              {host.renderBlockFields ? (
                host.renderBlockFields({ block, canWrite: host.canWrite, onChange: next => classicFields(block.id, next) })
              ) : (
                <p className="text-sm font-semibold text-foreground">{label(block.id)}</p>
              )}
            </div>
          ) : block ? (
            <p className="text-sm text-foreground-muted">Select an element of this section on the canvas or in the layers.</p>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-foreground-muted">Click anything on the canvas to select it. Double-click words to type in place.</p>
              {host.canWrite && (
                <button type="button" className={smallBtn} onClick={addSection}>
                  <Plus className="h-3.5 w-3.5" /> Add a section
                </button>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

/** An element's own classes when the panel can change them (written out, not worked out from data); null otherwise. */
function styleable(tree: CodeNode, id: string): string | null {
  const node = findNode(tree, id)?.node
  if (!node || !isTagNode(node) || node.ro) return null
  const cls = node.props.className
  if (!cls) return ''
  return cls.k === 'lit' && typeof cls.v === 'string' ? cls.v : null
}
