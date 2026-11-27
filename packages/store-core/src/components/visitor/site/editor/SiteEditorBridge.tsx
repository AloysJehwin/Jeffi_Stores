'use client'

import { useEffect } from 'react'
import { withBreakpoint, type DesignOp } from '@jeffi/site-blocks/design'
import { boxIn, createHandles } from './handles'
import type { RichSession } from './rich-text'

// The visual editor's side of the Site Builder canvas (docs/plans/SITE_EDITOR_PLAN.md), successor to
// SitePreviewBridge. Dormant until the editor (components/site-editor) sends `site-editor:mode`; then a click selects
// the element under it by its `data-e` node id (or the block, outside code sections), a double click edits an element
// whose words are written out (`data-e-text`, never data) in place, and the editor's operations that the page can show
// apply at once (text, classes, a picture); the rest show on the reload after the save. Every change goes back as
// design operations (@jeffi/site-blocks/design), which the editor records and saves; the save compiles them again.
//
// Rich text: a double click on a `data-e-rich` element (literal text with bold, italic, underline, strike, breaks and
// links) or on a text-only p, li, blockquote, figcaption, dd, td or span mounts Tiptap on it (rich-text.ts, imported on
// the first such edit). A commit with words only reports the `text` op as before; otherwise one `node` op (children
// only, `rich: true` on the message) that the editor completes from the live tree (rich-convert.ts mergeRich).
//
// Free layers (phase 3): a selected element positioned `absolute` gets move and resize handles (handles.ts); a drag
// or an arrow key reports its new box in % of its frame, and `measure` reports an element's box before it is placed.
// A rotate knob above it reports whole degrees. Shift-click adds or removes an element: the bridge reports the click
// (`shift`), the editor settles the selection and sends it back as a primary `id` plus `more` in the same section, which
// are all outlined; handles stay on a lone free layer, and arrow keys on several go to the editor.
//
// Messages in (from the parent only): mode { on, write }, select { block, id, more? }, apply { block, ops, seq },
// scroll-to { y }, measure { block, id, req }, place { block, id, rect | null, frame?, frameMinHeight? }, rotate { block, id, deg },
// flash { block, ids } (what an AI change touched, lit up for a moment), overflow { req } (the page check's screen
// sizes: what runs past this frame's width, answered without editing mode).
// Messages out: ready, select { block, id, tag, cmp, text, shift }, ops { block, ops, rich? }, applied { block, ops, seq },
// scroll { y }, key { action: 'undo' | 'redo' | 'delete' | 'escape' | 'group' | 'ungroup' | 'copy' | 'cut' | 'paste' |
// 'duplicate' | 'nudge' (dx, dy) | 'resize' (dx, dy) }, measured { req, rect, frame, frameHeight },
// placed { block, id, rect, sized }, rotated { block, id, deg }, overflowed { req, width, items: { block, id, right }[] }.

type Win = Window & { __siteEditorBridge?: boolean }
const P = 'site-editor:'
const RICH_TAGS = /^(p|li|blockquote|figcaption|dd|td|span)$/i
const inOverlay = (t: EventTarget | null) => t instanceof Element && !!t.closest('[data-e-overlay]')

export default function SiteEditorBridge() {
  useEffect(() => {
    const w = window as Win
    if (window.parent === window || w.__siteEditorBridge) return
    w.__siteEditorBridge = true
    let on = false
    let write = true
    const handles = createHandles(document)
    let selected: HTMLElement | null = null
    // The rest of a multiple selection (the primary is `selected`).
    let more: HTMLElement[] = []
    // `rich`: undefined while editing plain text; null while the rich editor loads; else its session.
    let editing: { el: HTMLElement; before: string; rich?: RichSession | null } | null = null
    const root = document.documentElement
    const send = (msg: Record<string, unknown>) => window.parent.postMessage({ ...msg, type: P + msg.type }, '*')
    const blockOf = (el: Element) => el.closest<HTMLElement>('[data-block-id]')?.dataset.blockId ?? null
    const nodeOf = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>('[data-block-id] [data-e]') : null)
    const blockEl = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>('[data-block-id]') : null)
    const sel = (block: string) => `[data-block-id="${CSS.escape(block)}"]`
    // A node inside a list or a render function draws once per item, each copy with its id.
    const findAll = (block: unknown, id: unknown) =>
      typeof block === 'string' && typeof id === 'string' ? [...document.querySelectorAll<HTMLElement>(`${sel(block)} [data-e="${CSS.escape(id)}"]`)] : []
    // The section's mark class (lib/site/code/css.ts codeMark) is the renderer's, not the element's own.
    const markOf = (el: Element) => el.closest('[data-code-section]')?.getAttribute('data-code-section') ?? ''
    const own = (el: Element) => [...el.classList].filter(c => c !== markOf(el)).join(' ')
    const setOwn = (el: Element, cls: string) => (el.className = [cls, markOf(el)].filter(Boolean).join(' '))
    // React's SSR puts a comment between neighbouring text nodes; committing writes one text node in their place.
    const textOnly = (el: Element) => el.hasAttribute('data-e-text') && [...el.childNodes].every(n => n.nodeType === Node.TEXT_NODE || n.nodeType === Node.COMMENT_NODE)

    const isFree = (el: HTMLElement) => getComputedStyle(el).position === 'absolute'
    /** Handles on the selection while it is a free layer. */
    const syncHandles = () => {
      const el = selected
      if (!on || !write || more.length || !el?.dataset.e || !isFree(el)) return handles.detach()
      const block = blockOf(el)
      const id = el.dataset.e
      handles.attach(el, {
        sized: false,
        onCommit: (rect, sized) => send({ type: 'placed', block, id, rect, sized }),
        onRotate: deg => send({ type: 'rotated', block, id, deg }),
      })
    }
    const mark = (el: HTMLElement | null, rest: HTMLElement[] = []) => {
      for (const x of [selected, ...more]) x?.removeAttribute('data-e-selected')
      selected = el
      more = el ? rest.filter(x => x !== el) : []
      for (const x of [selected, ...more]) x?.setAttribute('data-e-selected', '')
      syncHandles()
    }
    /** What a layer is placed in: its offsetParent once free; before, the nearest positioned ancestor in the section,
     * else the section's root (which the editor makes `relative`). */
    const frameOf = (el: HTMLElement): HTMLElement | null => {
      if (isFree(el)) return el.offsetParent instanceof HTMLElement ? el.offsetParent : null
      const top = el.closest('[data-code-section]')?.querySelector<HTMLElement>(':scope > [data-e]')
      for (let p = el.parentElement; p && top?.contains(p); p = p.parentElement) if (p === top || getComputedStyle(p).position !== 'static') return p
      return null
    }
    const select = (el: HTMLElement | null, shift = false) => {
      const id = el?.dataset.e ?? null
      // Shift-click only reports the click: the editor settles the selection and sends it back.
      if (!shift || !id) mark(el)
      if (!el) return
      send({ type: 'select', block: blockOf(el), id, tag: el.tagName.toLowerCase(), cmp: el.hasAttribute('data-e-cmp'), text: id && textOnly(el) ? el.textContent : null, shift: shift && !!id })
    }
    /** Typing in a field (or an element being edited): keys belong to it. */
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))
    /** What runs past the screen sideways, so the page scrolls or cuts it: the outermost such element of each section
     * that no ancestor clips or scrolls on purpose. Fixed layers never widen the page. */
    const overflowing = () => {
      const vw = root.clientWidth
      const found: HTMLElement[] = []
      for (const el of document.querySelectorAll<HTMLElement>('[data-block-id] *')) {
        if (found.some(f => f.contains(el))) continue
        const r = el.getBoundingClientRect()
        if (!r.width || !r.height || (r.right <= vw + 1 && r.left >= -1)) continue
        const cs = getComputedStyle(el)
        if (cs.position === 'fixed' || cs.visibility === 'hidden') continue
        let clipped = false
        for (let a = el.parentElement; a && a !== document.body && !clipped; a = a.parentElement) {
          const s = getComputedStyle(a)
          clipped = s.overflowX !== 'visible' || s.position === 'fixed'
        }
        if (!clipped) found.push(el)
      }
      return found.slice(0, 20).map(el => {
        const block = blockOf(el)
        const node = el.closest<HTMLElement>('[data-e]')
        return { block, id: node && blockOf(node) === block ? (node.dataset.e ?? null) : null, right: Math.round(el.getBoundingClientRect().right) }
      })
    }
    const reveal = (el: HTMLElement) => {
      const r = el.getBoundingClientRect()
      if (r.bottom < 0 || r.top > window.innerHeight) el.scrollIntoView({ block: 'center' })
    }

    const commit = (keep: boolean) => {
      if (!editing) return
      const { el, before, rich } = editing
      editing = null
      if (rich !== undefined) {
        // Rich edit: still loading leaves the element as it was.
        const done = rich?.finish(keep)
        if (keep && done && el.dataset.e) send({ type: 'ops', block: blockOf(el), ops: done.ops, ...(done.rich ? { rich: true } : {}) })
        return
      }
      el.removeAttribute('contenteditable')
      if (!keep) return void (el.textContent = before)
      // Typed line breaks read as spaces, as JSX text does.
      const value = (el.textContent ?? '').replace(/\s*\n\s*/g, ' ')
      el.textContent = value
      const id = el.dataset.e
      if (id && value !== before) send({ type: 'ops', block: blockOf(el), ops: [{ op: 'text', id, value } satisfies DesignOp] })
    }

    /** One operation shown on the page; false when it isn't one the canvas can show (the reload will). */
    const show = (block: unknown, op: DesignOp): boolean => {
      const els = 'id' in op ? findAll(block, op.id) : []
      if (!els.length) return false
      try {
        if (op.op === 'text' && typeof op.value === 'string' && els.every(textOnly)) els.forEach(el => (el.textContent = op.value as string))
        // A part's root holds its own classes beside the node's, so those wait for the reload.
        else if (op.op === 'classes' && Array.isArray(op.value) && !els.some(el => el.hasAttribute('data-e-cmp')))
          els.forEach(el => setOwn(el, withBreakpoint(own(el), op.bp, op.value as string[])))
        else if (op.op === 'attr' && op.name === 'className' && !els.some(el => el.hasAttribute('data-e-cmp'))) els.forEach(el => setOwn(el, typeof op.value === 'string' ? op.value : ''))
        else if (op.op === 'attr' && (op.name === 'src' || op.name === 'alt') && els.every(el => el instanceof HTMLImageElement) && typeof op.value === 'string')
          els.forEach(el => {
            if (op.name === 'src') el.removeAttribute('srcset')
            el.setAttribute(op.name, op.value as string)
          })
        else return false
      } catch {
        return false
      }
      return true
    }

    const onClick = (e: MouseEvent) => {
      if (!on) return
      const el = nodeOf(e.target)
      if (editing && el && editing.el.contains(el)) return
      const block = el ? null : blockEl(e.target)
      if (!el && !block) return
      // Links and buttons on the canvas select instead of navigating.
      e.preventDefault()
      e.stopPropagation()
      commit(true)
      select(el ?? block, e.shiftKey && !!el)
    }
    // Shift-click adds to the selection, not to the page's text selection.
    const onMouseDown = (e: MouseEvent) => {
      if (on && e.shiftKey && !editing && nodeOf(e.target)) e.preventDefault()
    }
    /** Mounts the rich editor on `el`; Tiptap loads on the first call only. */
    const startRich = (el: HTMLElement) => {
      const wasText = textOnly(el)
      const state: NonNullable<typeof editing> = { el, before: el.textContent ?? '', rich: null }
      editing = state
      import('./rich-text')
        .then(m => {
          if (editing === state) state.rich = m.mountRich(el, wasText)
        })
        .catch(() => {
          if (editing === state) editing = null
        })
    }
    const onDblClick = (e: MouseEvent) => {
      if (!on) return
      const el = nodeOf(e.target)
      if (!el) return
      const rich = el.closest<HTMLElement>('[data-e-rich]') ?? (textOnly(el) && RICH_TAGS.test(el.tagName) ? el : null)
      if (!rich && !textOnly(el)) return
      e.preventDefault()
      commit(true)
      if (rich) {
        select(rich)
        return startRich(rich)
      }
      select(el)
      editing = { el, before: el.textContent ?? '' }
      el.setAttribute('contenteditable', 'plaintext-only')
      if (el.contentEditable !== 'plaintext-only') el.setAttribute('contenteditable', 'true')
      el.focus()
      const range = document.createRange()
      range.selectNodeContents(el)
      const s = window.getSelection()
      s?.removeAllRanges()
      s?.addRange(range)
    }
    const onKey = (e: KeyboardEvent) => {
      if (!on) return
      if (editing) {
        // The rich editor's toolbar (the link field) takes its own keys.
        if (editing.rich !== undefined && inOverlay(e.target)) return
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          commit(true)
        } else if (e.key === 'Escape') commit(false)
        return
      }
      if (typing(e.target)) return
      const mod = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()
      // Arrow keys nudge a free layer by 1% (5% with shift); with alt they resize it. On several, the editor moves them.
      const step = e.shiftKey ? 5 : 1
      const arrow = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
      if (arrow && (handles.target || more.length)) {
        e.preventDefault()
        if (more.length) return send({ type: 'key', action: e.altKey ? 'resize' : 'nudge', dx: arrow[0], dy: arrow[1] })
        return e.altKey ? handles.resize(arrow[0], arrow[1]) : handles.nudge(arrow[0], arrow[1])
      }
      // Copy and cut leave a text selection alone.
      const textSelected = !!window.getSelection()?.toString()
      const action =
        mod && key === 'z'
          ? e.shiftKey
            ? 'redo'
            : 'undo'
          : mod && key === 'y'
            ? 'redo'
            : mod && key === 'g'
              ? e.shiftKey
                ? 'ungroup'
                : 'group'
              : mod && key === 'd'
                ? 'duplicate'
                : mod && (key === 'c' || key === 'x') && !textSelected
                  ? key === 'c'
                    ? 'copy'
                    : 'cut'
                  : mod && key === 'v'
                    ? 'paste'
                    : e.key === 'Delete' || e.key === 'Backspace'
                      ? 'delete'
                      : e.key === 'Escape'
                        ? 'escape'
                        : null
      if (!action) return
      e.preventDefault()
      if (action === 'escape') mark(null)
      send({ type: 'key', action })
    }
    // Pasted content goes in as plain text only.
    const onPaste = (e: ClipboardEvent) => {
      if (!editing || editing.rich !== undefined) return
      e.preventDefault()
      const text = e.clipboardData?.getData('text/plain') ?? ''
      const range = window.getSelection()?.getRangeAt(0)
      if (!range || !editing.el.contains(range.commonAncestorContainer)) return
      range.deleteContents()
      range.insertNode(document.createTextNode(text))
      range.collapse(false)
    }
    const onBlur = (e: FocusEvent) => {
      if (!editing) return
      // Focus moving between the rich editor and its toolbar's link field keeps the edit going.
      const to = e.relatedTarget
      const within = to instanceof Node && (editing.el.contains(to) || inOverlay(to))
      if ((e.target === editing.el || (editing.rich !== undefined && inOverlay(e.target))) && !(editing.rich !== undefined && within)) commit(true)
    }
    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        send({ type: 'scroll', y: Math.round(window.scrollY) })
        handles.refresh()
        editing?.rich?.refresh()
      })
    }
    const onResize = () => {
      handles.refresh()
      editing?.rich?.refresh()
    }
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent || typeof e.data?.type !== 'string' || !e.data.type.startsWith(P)) return
      const kind = e.data.type.slice(P.length)
      if (kind === 'mode') {
        on = e.data.on === true
        write = e.data.write !== false
        root.toggleAttribute('data-site-editing', on)
        if (!on) {
          commit(true)
          mark(null)
        }
      } else if (kind === 'select') {
        const el = typeof e.data.block === 'string' ? (e.data.id ? findAll(e.data.block, e.data.id)[0] : document.querySelector<HTMLElement>(sel(e.data.block))) : null
        const rest = el && Array.isArray(e.data.more) ? (e.data.more as unknown[]).flatMap(id => findAll(e.data.block, id).slice(0, 1)) : []
        mark(el ?? null, rest)
        if (el) reveal(el)
      } else if (kind === 'apply' && Array.isArray(e.data.ops)) {
        const ops = (e.data.ops as DesignOp[]).filter(op => op && typeof op === 'object' && show(e.data.block, op))
        send({ type: 'applied', block: e.data.block, ops, seq: e.data.seq })
      } else if (kind === 'scroll-to' && typeof e.data.y === 'number') window.scrollTo({ top: e.data.y })
      else if (kind === 'measure') {
        const el = findAll(e.data.block, e.data.id)[0]
        const frame = el && frameOf(el)
        send({ type: 'measured', req: e.data.req, rect: el && frame ? boxIn(el, frame) : null, frame: frame?.dataset.e ?? null, frameHeight: frame ? frame.getBoundingClientRect().height : null })
      } else if (kind === 'overflow') {
        // After the fonts, and a beat for late pictures.
        const req = e.data.req
        void document.fonts.ready.then(() => setTimeout(() => send({ type: 'overflowed', req, width: root.clientWidth, items: overflowing() }), 400))
      } else if (kind === 'flash' && Array.isArray(e.data.ids)) {
        const els = (e.data.ids as unknown[]).flatMap(id => findAll(e.data.block, id))
        els.forEach(el => el.setAttribute('data-e-flash', ''))
        els[0]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
        setTimeout(() => els.forEach(el => el.removeAttribute('data-e-flash')), 2600)
      } else if (kind === 'rotate' && typeof e.data.deg === 'number') {
        // Shown at once; the class draws it after the save's reload.
        for (const el of findAll(e.data.block, e.data.id)) el.style.transform = e.data.deg ? `rotate(${e.data.deg}deg)` : 'none'
        handles.refresh()
      } else if (kind === 'place') {
        // Shown at once with inline styles; the classes draw it after the save's reload.
        const r = e.data.rect as { left: number; top: number; width: number; height?: number } | null
        for (const el of findAll(e.data.block, e.data.id))
          Object.assign(el.style, r ? { position: 'absolute', left: `${r.left}%`, top: `${r.top}%`, width: `${r.width}%`, height: r.height !== undefined ? `${r.height}%` : '' } : { position: '', left: '', top: '', width: '', height: '' })
        const frame = typeof e.data.frame === 'string' ? findAll(e.data.block, e.data.frame)[0] : null
        if (frame) {
          if (getComputedStyle(frame).position === 'static') frame.style.position = 'relative'
          if (typeof e.data.frameMinHeight === 'number') frame.style.minHeight = `${e.data.frameMinHeight}px`
        }
        syncHandles()
      }
    }

    document.addEventListener('click', onClick, true)
    document.addEventListener('dblclick', onDblClick, true)
    document.addEventListener('mousedown', onMouseDown, true)
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('paste', onPaste, true)
    document.addEventListener('focusout', onBlur, true)
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize)
    window.addEventListener('message', onMessage)
    send({ type: 'ready' })
    return () => {
      commit(false)
      mark(null)
      cancelAnimationFrame(raf)
      handles.detach()
      root.removeAttribute('data-site-editing')
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('dblclick', onDblClick, true)
      document.removeEventListener('mousedown', onMouseDown, true)
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('paste', onPaste, true)
      document.removeEventListener('focusout', onBlur, true)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('message', onMessage)
      w.__siteEditorBridge = false
    }
  }, [])
  return (
    <style>{`[data-site-editing] [data-block-id]{cursor:default}[data-site-editing] [data-block-id] [data-e]:hover{outline:1px dashed rgb(var(--c-accent-500) / .7);outline-offset:1px}[data-e-selected]{outline:2px solid rgb(var(--c-accent-500))!important;outline-offset:1px}[data-e][contenteditable]{cursor:text;outline:2px solid rgb(var(--c-accent-500))!important}[data-e-flash]{outline:2px solid rgb(var(--c-accent-500))!important;outline-offset:2px;animation:site-e-flash 1.3s ease-in-out 2}@keyframes site-e-flash{50%{outline-color:transparent}}`}</style>
  )
}
