'use client'

import { useEffect } from 'react'
import { withBreakpoint, type DesignOp } from '@jeffi/site-blocks/design'

// The visual editor's side of the Site Builder canvas (docs/plans/SITE_EDITOR_PLAN.md, phase 0), successor to
// SitePreviewBridge for code sections. Dormant until the editor sends `site-editor:mode`; then a click selects the
// element under it by its `data-e` node id, a double click edits an element whose words are written out
// (`data-e-text`, never data) in place, and the editor's text and class operations show at once. Every change goes
// back to the editor as design operations (@jeffi/site-blocks/design), which it records and saves; the save compiles
// them again.
//
// Messages in (from the parent only): mode { on }, select { block, id }, apply { block, ops }.
// Messages out: ready, select { block, id, tag, className, text }, ops { block, ops }, applied { block, ops }.

type Win = Window & { __siteEditorBridge?: boolean }
const P = 'site-editor:'

export default function SiteEditorBridge() {
  useEffect(() => {
    const w = window as Win
    if (window.parent === window || w.__siteEditorBridge) return
    w.__siteEditorBridge = true
    let on = false
    let selected: HTMLElement | null = null
    let editing: { el: HTMLElement; before: string } | null = null
    const root = document.documentElement
    const send = (msg: Record<string, unknown>) => window.parent.postMessage({ ...msg, type: P + msg.type }, '*')
    const blockOf = (el: Element) => el.closest<HTMLElement>('[data-block-id]')?.dataset.blockId ?? null
    const nodeOf = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>('[data-block-id] [data-e]') : null)
    // A node inside a list or a render function draws once per item, each copy with its id.
    const findAll = (block: unknown, id: unknown) =>
      typeof block === 'string' && typeof id === 'string' ? [...document.querySelectorAll<HTMLElement>(`[data-block-id="${CSS.escape(block)}"] [data-e="${CSS.escape(id)}"]`)] : []
    const find = (block: unknown, id: unknown) => findAll(block, id)[0] ?? null
    // The section's mark class (lib/site/code/css.ts codeMark) is the renderer's, not the element's own.
    const markOf = (el: Element) => el.closest('[data-code-section]')?.getAttribute('data-code-section') ?? ''
    const own = (el: Element) => [...el.classList].filter(c => c !== markOf(el)).join(' ')
    const setOwn = (el: Element, cls: string) => (el.className = [cls, markOf(el)].filter(Boolean).join(' '))
    // React's SSR puts a comment between neighbouring text nodes; committing writes one text node in their place.
    const textOnly = (el: Element) => el.hasAttribute('data-e-text') && [...el.childNodes].every(n => n.nodeType === Node.TEXT_NODE || n.nodeType === Node.COMMENT_NODE)

    const select = (el: HTMLElement | null) => {
      selected?.removeAttribute('data-e-selected')
      selected = el
      if (!el) return
      el.setAttribute('data-e-selected', '')
      send({ type: 'select', block: blockOf(el), id: el.dataset.e, tag: el.tagName.toLowerCase(), className: own(el), text: textOnly(el) ? el.textContent : null })
    }

    const commit = (keep: boolean) => {
      if (!editing) return
      const { el, before } = editing
      editing = null
      el.removeAttribute('contenteditable')
      if (!keep) return void (el.textContent = before)
      // Typed line breaks read as spaces, as JSX text does.
      const value = (el.textContent ?? '').replace(/\s*\n\s*/g, ' ')
      el.textContent = value
      if (value !== before) send({ type: 'ops', block: blockOf(el), ops: [{ op: 'text', id: el.dataset.e, value } satisfies DesignOp] })
    }

    /** One operation shown on the page; false when it isn't one the canvas can show (the soft refresh will). */
    const show = (block: unknown, op: DesignOp): boolean => {
      const els = 'id' in op ? findAll(block, op.id) : []
      if (!els.length) return false
      if (op.op === 'text' && typeof op.value === 'string' && els.every(textOnly)) els.forEach(el => (el.textContent = op.value as string))
      else if (op.op === 'classes' && Array.isArray(op.value)) els.forEach(el => setOwn(el, withBreakpoint(own(el), op.bp, op.value as string[])))
      else if (op.op === 'attr' && op.name === 'className') els.forEach(el => setOwn(el, typeof op.value === 'string' ? op.value : ''))
      else return false
      return true
    }

    const onClick = (e: MouseEvent) => {
      if (!on) return
      const el = nodeOf(e.target)
      if (!el || (editing && editing.el.contains(el))) return
      e.preventDefault()
      e.stopPropagation()
      commit(true)
      select(el)
    }
    const onDblClick = (e: MouseEvent) => {
      if (!on) return
      const el = nodeOf(e.target)
      if (!el || !textOnly(el)) return
      e.preventDefault()
      commit(true)
      select(el)
      editing = { el, before: el.textContent ?? '' }
      el.setAttribute('contenteditable', 'plaintext-only')
      if (el.contentEditable !== 'plaintext-only') el.setAttribute('contenteditable', 'true')
      el.focus()
      const range = document.createRange()
      range.selectNodeContents(el)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    }
    const onKey = (e: KeyboardEvent) => {
      if (!editing) return
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        commit(true)
      } else if (e.key === 'Escape') commit(false)
    }
    // Pasted content goes in as plain text only.
    const onPaste = (e: ClipboardEvent) => {
      if (!editing) return
      e.preventDefault()
      const text = e.clipboardData?.getData('text/plain') ?? ''
      const range = window.getSelection()?.getRangeAt(0)
      if (!range || !editing.el.contains(range.commonAncestorContainer)) return
      range.deleteContents()
      range.insertNode(document.createTextNode(text))
      range.collapse(false)
    }
    const onBlur = (e: FocusEvent) => {
      if (editing && e.target === editing.el) commit(true)
    }
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent || typeof e.data?.type !== 'string' || !e.data.type.startsWith(P)) return
      const kind = e.data.type.slice(P.length)
      if (kind === 'mode') {
        on = e.data.on === true
        root.toggleAttribute('data-site-editing', on)
        if (!on) {
          commit(true)
          select(null)
        }
      } else if (kind === 'select') select(find(e.data.block, e.data.id))
      else if (kind === 'apply' && Array.isArray(e.data.ops)) {
        const ops = (e.data.ops as DesignOp[]).filter(op => op && typeof op === 'object' && show(e.data.block, op))
        send({ type: 'applied', block: e.data.block, ops })
      }
    }

    document.addEventListener('click', onClick, true)
    document.addEventListener('dblclick', onDblClick, true)
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('paste', onPaste, true)
    document.addEventListener('focusout', onBlur, true)
    window.addEventListener('message', onMessage)
    send({ type: 'ready' })
    return () => {
      commit(false)
      select(null)
      root.removeAttribute('data-site-editing')
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('dblclick', onDblClick, true)
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('paste', onPaste, true)
      document.removeEventListener('focusout', onBlur, true)
      window.removeEventListener('message', onMessage)
      w.__siteEditorBridge = false
    }
  }, [])
  return (
    <style>{`[data-site-editing] [data-block-id] [data-e]{cursor:default}[data-site-editing] [data-block-id] [data-e]:hover{outline:1px dashed rgb(var(--c-accent-500) / .7);outline-offset:1px}[data-e-selected]{outline:2px solid rgb(var(--c-accent-500))!important;outline-offset:1px}[data-e][contenteditable]{cursor:text;outline:2px solid rgb(var(--c-accent-500))!important}`}</style>
  )
}
