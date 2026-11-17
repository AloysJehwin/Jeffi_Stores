'use client'

import { useEffect } from 'react'

// Inside the Site Builder canvas. With the editor's arrow (select) tool on, hovering outlines a block and a click
// selects it (links don't navigate) and tells the editor what was pointed at, so the owner or the AI can correct that
// exact part; with it off the page behaves like the live site. The editor can also outline and scroll to a block.
// When the editor allows moving, a hovered block of the page being edited shows a handle: dragging it draws a drop line
// between blocks, and the release asks the editor to move the block there (its undo and autosave apply). The header,
// footer and announcement bar sit in `data-site-page` wrappers and render a bridge each; the first one serves all.

const CHROME = new Set(['header', 'footer', 'announcement'])

type Win = Window & { __siteBuilderBridge?: boolean }

export default function SitePreviewBridge() {
  useEffect(() => {
    const w = window as Win
    if (window.parent === window || w.__siteBuilderBridge) return
    w.__siteBuilderBridge = true
    let picking = true
    let canDrag = false
    // The page the editor has open; null until it says.
    let editing: string | null = null
    const root = document.documentElement
    root.toggleAttribute('data-site-picking', picking)
    const send = (msg: object) => window.parent.postMessage(msg, '*')
    const blockOf = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>('[data-block-id]') : null)
    // The page a block belongs to: a site-wide part (data-site-page), else the page itself (null).
    const pageOf = (el: Element) => el.closest('[data-site-page]')?.getAttribute('data-site-page') ?? null
    const editable = (el: HTMLElement) => (editing && CHROME.has(editing) ? pageOf(el) === editing : pageOf(el) === null)
    // The innermost block under `t` that belongs to the page being edited.
    const editableOf = (t: EventTarget | null) => {
      let b = blockOf(t)
      while (b && !editable(b)) b = blockOf(b.parentElement)
      return b
    }
    const mark = (id: string | null) => {
      document.querySelectorAll('[data-block-selected]').forEach(el => el.removeAttribute('data-block-selected'))
      const el = id ? document.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(id)}"]`) : null
      if (el) {
        el.setAttribute('data-block-selected', '')
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      }
    }

    // Floating parts: the handle on the hovered block, the drop line, and a label following the pointer.
    const part = (css: string) => {
      const el = document.createElement('div')
      el.style.cssText = `position:fixed;z-index:2147483000;display:none;${css}`
      document.body.appendChild(el)
      return el
    }
    const handle = part(
      'cursor:grab;touch-action:none;user-select:none;padding:5px 9px;border-radius:7px;font:600 12px/1.2 system-ui,sans-serif;color:#fff;background:rgb(var(--c-accent-500));box-shadow:0 1px 4px rgba(0,0,0,.3)'
    )
    handle.textContent = '↕ Move'
    handle.title = 'Drag to move this block'
    handle.setAttribute('aria-hidden', 'true')
    const line = part('height:4px;border-radius:2px;pointer-events:none;background:rgb(var(--c-accent-500));box-shadow:0 0 0 2px rgba(255,255,255,.85)')
    const ghost = part('pointer-events:none;padding:5px 9px;border-radius:7px;font:500 12px/1.2 system-ui,sans-serif;color:#fff;background:rgba(17,24,39,.88);max-width:260px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')

    let hovered: HTMLElement | null = null
    let drag: { el: HTMLElement; target: HTMLElement | null; place: 'before' | 'after'; x: number; y: number; raf: number; pointer: number } | null = null

    const placeHandle = () => {
      if (!hovered?.isConnected || !canDrag) {
        hovered = null
        handle.style.display = 'none'
        return
      }
      const r = hovered.getBoundingClientRect()
      handle.style.display = 'block'
      handle.style.left = `${Math.max(4, r.left + 8)}px`
      handle.style.top = `${Math.min(Math.max(4, r.top + 8), Math.max(4, r.bottom - 32))}px`
    }

    const onOver = (e: PointerEvent) => {
      if (drag || !canDrag || e.target === handle) return
      const b = editableOf(e.target)
      if (b !== hovered) {
        hovered = b
        placeHandle()
      }
    }

    // The block under the pointer to drop beside (not the dragged one or anything inside it), and which side.
    const update = () => {
      if (!drag) return
      const under = document.elementsFromPoint(drag.x, drag.y).find(n => n !== handle)
      const b = under ? editableOf(under) : null
      const target = b && b !== drag.el && !drag.el.contains(b) ? b : null
      drag.target = target
      if (!target) return void (line.style.display = 'none')
      const r = target.getBoundingClientRect()
      drag.place = drag.y < r.top + r.height / 2 ? 'before' : 'after'
      line.style.display = 'block'
      line.style.left = `${r.left}px`
      line.style.width = `${r.width}px`
      line.style.top = `${(drag.place === 'before' ? r.top : r.bottom) - 2}px`
    }

    // Near the top or bottom edge the page scrolls, so a block can go anywhere.
    const tick = () => {
      if (!drag) return
      const edge = 56
      const dy = drag.y < edge ? -Math.ceil((edge - drag.y) / 3) : drag.y > window.innerHeight - edge ? Math.ceil((drag.y - window.innerHeight + edge) / 3) : 0
      if (dy) {
        window.scrollBy(0, dy)
        update()
      }
      drag.raf = requestAnimationFrame(tick)
    }

    const end = () => {
      if (!drag) return
      cancelAnimationFrame(drag.raf)
      drag.el.removeAttribute('data-block-dragging')
      if (handle.hasPointerCapture(drag.pointer)) handle.releasePointerCapture(drag.pointer)
      drag = null
      root.removeAttribute('data-site-dragging')
      line.style.display = 'none'
      ghost.style.display = 'none'
      hovered = null
      placeHandle()
    }

    const onDown = (e: PointerEvent) => {
      if (!hovered || !canDrag || e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      handle.setPointerCapture(e.pointerId)
      drag = { el: hovered, target: null, place: 'after', x: e.clientX, y: e.clientY, raf: 0, pointer: e.pointerId }
      hovered.setAttribute('data-block-dragging', '')
      root.setAttribute('data-site-dragging', '')
      handle.style.display = 'none'
      ghost.textContent = `Moving: ${(hovered.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 48) || 'block'}`
      ghost.style.display = 'block'
      drag.raf = requestAnimationFrame(tick)
      onMove(e)
    }
    const onMove = (e: PointerEvent) => {
      if (!drag) return
      drag.x = e.clientX
      drag.y = e.clientY
      ghost.style.left = `${e.clientX + 14}px`
      ghost.style.top = `${e.clientY + 14}px`
      update()
    }
    const onUp = () => {
      const d = drag
      end()
      if (d?.target?.dataset.blockId && d.el.dataset.blockId)
        send({ type: 'site-builder:move', id: d.el.dataset.blockId, target: d.target.dataset.blockId, place: d.place, page: pageOf(d.el) })
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') end()
    }
    const onScroll = () => {
      if (drag) update()
      else placeHandle()
    }
    const onLeave = () => {
      if (drag) return
      hovered = null
      placeHandle()
    }

    const onClick = (e: MouseEvent) => {
      if (!picking) return
      const el = blockOf(e.target)
      if (!el) return
      e.preventDefault()
      e.stopPropagation()
      const target = e.target instanceof HTMLElement ? e.target : null
      const img = target?.closest('img')
      const hint = img ? `image: ${img.getAttribute('alt') || 'untitled'}` : (target?.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 160)
      mark(el.dataset.blockId!)
      send({ type: 'site-builder:select', id: el.dataset.blockId, hint, tag: target?.tagName.toLowerCase() ?? null, page: pageOf(el) })
    }
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent) return
      if (e.data?.type === 'site-builder:highlight') mark(typeof e.data.id === 'string' ? e.data.id : null)
      if (e.data?.type === 'site-builder:pick') {
        picking = !!e.data.on
        canDrag = picking && e.data.drag === true
        editing = typeof e.data.page === 'string' ? e.data.page : null
        root.toggleAttribute('data-site-picking', picking)
        if (!canDrag) end()
        hovered = hovered && canDrag && editable(hovered) ? hovered : null
        placeHandle()
      }
    }
    document.addEventListener('click', onClick, true)
    document.addEventListener('pointerover', onOver)
    root.addEventListener('pointerleave', onLeave)
    handle.addEventListener('pointerdown', onDown)
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', end)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('message', onMessage)
    window.parent.postMessage({ type: 'site-builder:ready' }, '*')
    return () => {
      end()
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('pointerover', onOver)
      root.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('message', onMessage)
      handle.remove()
      line.remove()
      ghost.remove()
      w.__siteBuilderBridge = false
    }
  }, [])
  return (
    <style>{`[data-site-picking] [data-block-id]{position:relative;cursor:pointer}[data-site-picking] [data-block-id]:hover{outline:2px dashed rgb(var(--c-accent-500) / .6);outline-offset:-2px}[data-block-selected]{outline:3px solid rgb(var(--c-accent-500))!important;outline-offset:-3px}[data-block-dragging]{opacity:.45}[data-site-dragging],[data-site-dragging] *{cursor:grabbing!important;user-select:none!important}`}</style>
  )
}
