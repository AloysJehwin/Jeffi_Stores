'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Monitor, Redo2, Rocket, Smartphone, Tablet, Undo2, X } from 'lucide-react'
import { isTagNode, type CodeNode } from '@jeffi/site-blocks'
import { DesignError, findNode, type Breakpoint, type DesignOp } from '@jeffi/site-blocks/design'
import { classOps, setPanelValue, type PanelProp } from '@/lib/site/code/classes'
import type { SiteEditorHost } from './host'
import Inspector from './Inspector'
import StylePanel, { BREAKPOINT_NAME } from './StylePanel'
import { adoptSaved, canRedo, canUndo, createEditor, currentTrees, docToSave, editSection, endGestures, redo, treeOf, undo, type EditorState, type Shown } from './state'

// The visual site editor (docs/plans/SITE_EDITOR_PLAN.md, phase 2): the real page on a canvas (an iframe with a
// preview token, where components/visitor/site/editor/SiteEditorBridge selects and edits in place), the page's
// sections on the left, the selected element on the right. Every change is a design operation recorded in one
// history (state.ts) and autosaved through the host; the server compiles what it saves, so the canvas reloads only
// for changes it can't show by itself.

const P = 'site-editor:'
const SAVE_AFTER_MS = 800
/** The canvas per breakpoint (Tailwind's base, md and lg). */
const WIDTH: Partial<Record<Breakpoint, number>> = { base: 390, md: 768, lg: 1280 }
const BREAKPOINTS = [
  ['base', Smartphone],
  ['md', Tablet],
  ['lg', Monitor],
] as const

type Selection = { block: string; id: string | null } | null
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
  const edit = (block: string, ops: DesignOp[], gesture?: string) => {
    if (update(s => editSection(s, block, ops, gesture))) applyOnCanvas(block, ops)
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
  const style = (block: string, id: string, prop: PanelProp, value: string | null) => {
    const node = findNode(latest.current.state?.trees[block]?.tree ?? { t: 'frag', children: [] }, id)?.node
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
      post({ type: 'mode', on: true })
      const at = latest.current.sel
      if (at) post({ type: 'select', block: at.block, id: at.id })
      if (scrollY.current) post({ type: 'scroll-to', y: scrollY.current })
    } else if (kind === 'select' && typeof m.block === 'string') setSel({ block: m.block, id: typeof m.id === 'string' ? m.id : null })
    else if (kind === 'ops' && typeof m.block === 'string' && Array.isArray(m.ops)) {
      // Typed in place: the canvas shows it already. Refused (it changed since), the reload puts the page right.
      if (!hostRef.current.canWrite || !update(s => editSection(s, m.block as string, m.ops as DesignOp[]))) setFrameKey(k => k + 1)
    } else if (kind === 'applied' && typeof m.seq === 'number') {
      const want = seq.current.sent.get(m.seq)
      seq.current.sent.delete(m.seq)
      if (want !== undefined && (!Array.isArray(m.ops) || m.ops.length < want)) requestReload()
    } else if (kind === 'scroll' && typeof m.y === 'number') scrollY.current = m.y
    else if (kind === 'key') {
      if (m.action === 'undo' || m.action === 'redo') step(m.action)
      if (m.action === 'escape') setSel(null)
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

  const ready = !!state
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
  const tree = sel ? (state.trees[sel.block]?.tree ?? null) : null
  const label = (id: string) => {
    const b = doc.blocks[id]
    return (typeof b?.props?.label === 'string' && b.props.label) || hostRef.current.blockLabel?.(b?.type ?? '') || b?.type || 'Block'
  }
  const iconBtn = 'p-1.5 rounded-md border border-border-default text-foreground-muted hover:text-foreground disabled:opacity-40'
  const statusText = status.kind === 'pending' ? 'Unsaved changes…' : status.kind === 'saving' ? 'Saving…' : status.kind === 'saved' ? 'Saved to draft' : status.kind === 'error' ? status.message : ''
  const busy = status.kind === 'pending' || status.kind === 'saving'

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border-default bg-surface-elevated p-2">
        <p className="px-1 text-sm font-semibold text-foreground">{host.title}</p>
        <span className="rounded-full bg-accent-500/10 px-2 py-0.5 text-[11px] font-medium text-accent-600">Visual editor · beta</span>
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
          <p className="pb-1 text-xs font-semibold uppercase tracking-wide text-foreground-muted">Sections</p>
          {doc.order.map(id => (
            <button
              key={id}
              type="button"
              onClick={() => select(id, treeOf(doc.blocks[id]) ? (state.trees[id]?.tree.id ?? null) : null)}
              className={`w-full truncate rounded-lg px-2.5 py-2 text-left text-sm ${sel?.block === id ? 'bg-accent-500/10 text-accent-700' : 'text-foreground hover:bg-surface-secondary'}`}
            >
              {label(id)}
            </button>
          ))}
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

        <aside className="rounded-xl border border-border-default bg-surface-elevated p-3 min-w-0 xl:min-h-0 xl:overflow-y-auto [scrollbar-width:thin]">
          {sel && tree && sel.id ? (
            <Inspector
              key={`${sel.block}:${sel.id}`}
              tree={tree}
              id={sel.id}
              canWrite={host.canWrite}
              onSelect={id => select(sel.block, id)}
              onText={(id, value) => edit(sel.block, [{ op: 'text', id, value }], `text:${id}`)}
              onDone={() => update(endGestures)}
            >
              {styleable(tree, sel.id) !== null && (
                <StylePanel key={bp} className={styleable(tree, sel.id) ?? ''} bp={bp} theme={host.theme} canWrite={host.canWrite} onChange={(prop, value) => style(sel.block, sel.id!, prop, value)} />
              )}
            </Inspector>
          ) : block ? (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-foreground">{label(block.id)}</p>
              <p className="text-sm text-foreground-muted">This block is set up with its own fields. Open it in the forms editor to change it; here it can be moved with the page.</p>
            </div>
          ) : (
            <p className="text-sm text-foreground-muted">Click anything on the canvas to select it. Double-click words to type in place.</p>
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
