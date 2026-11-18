'use client'

import { useEffect } from 'react'

// Runs inside the studio's preview frame. Links don't navigate (a link to another page of the site asks the wizard to
// show it instead), forms don't submit, and in picking mode a click selects the section under the pointer. While the
// wizard lets the owner arrange the page (`arrange`), a hovered section shows a handle: dragging it draws a drop line
// between that page's sections and the release asks the wizard to move it ('move'). Talks to the wizard by
// postMessage on the same origin (type 'studio-preview').

// [path, page, the page to show instead when the session has no design for it (an older plan)]
const PAGE_OF: [RegExp, string, string?][] = [
  [/^\/$/, 'home'],
  [/^\/(category|categories)\/[^/]/, 'category', 'products'],
  [/^\/(brand|brands)\/[^/]/, 'brand', 'products'],
  [/^\/categories\/?$/, 'categories'],
  [/^\/brands\/?$/, 'brands'],
  [/^\/products?\/[^/]/, 'product'],
  [/^\/(products|shop|collections?)(\/|$)/, 'products'],
  [/^\/search/, 'search'],
  [/^\/cart/, 'cart'],
  [/^\/checkout/, 'checkout'],
  [/^\/about/, 'about'],
  [/^\/contact/, 'contact'],
  [/^\/(support|help)/, 'support'],
  [/^\/(login|signin)/, 'login'],
  [/^\/(signup|register)/, 'signup'],
  // An order wears the order page's design and the order list the account pages' (an older plan themes both as orders).
  [/^\/account\/orders\/[^/]/, 'track', 'account'],
  [/^\/account\/orders|^\/orders/, 'orders', 'account'],
  [/^\/account/, 'account'],
  [/^\/wishlist/, 'wishlist'],
  [/^\/compare/, 'compare'],
  [/^\/(legal|privacy|terms)/, 'legal'],
  [/^\/return/, 'returns'],
  [/^\/track/, 'track'],
]

const send = (msg: object) => window.parent?.postMessage({ type: 'studio-preview', ...msg }, window.location.origin)

/** `pages`: the session's page keys, so a link opens its page's own design or, without one, the page that stands in. */
export default function PreviewBridge({ audience, pages }: { audience: 'store' | 'business'; pages?: string[] }) {
  const planned = pages?.join('|') ?? ''
  useEffect(() => {
    const has = new Set(planned.split('|'))
    let picking = false
    let arrange = false
    const root = document.documentElement
    const select = (id: string | null) => {
      document.querySelectorAll('[data-studio-selected]').forEach(el => el.removeAttribute('data-studio-selected'))
      if (id) document.querySelector(`[data-studio-block="${CSS.escape(id)}"]`)?.setAttribute('data-studio-selected', '')
    }
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== window.parent || e.data?.type !== 'studio-preview') return
      if ('arrange' in e.data) {
        arrange = !!e.data.arrange
        mover.refresh()
      }
      if (!('picking' in e.data)) return
      picking = !!e.data.picking
      mover.refresh()
      root.classList.toggle('studio-picking', picking)
      select(typeof e.data.picked === 'string' ? e.data.picked : null)
    }
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null
      if (!target?.closest) return
      if (picking) {
        const block = target.closest('[data-studio-block]') as HTMLElement | null
        e.preventDefault()
        e.stopPropagation()
        if (!block) return
        select(block.dataset.studioBlock ?? null)
        send({ event: 'pick', page: block.dataset.studioPage, blockId: block.dataset.studioBlock, label: block.dataset.studioLabel })
        return
      }
      const a = target.closest('a[href]') as HTMLAnchorElement | null
      if (!a) return
      e.preventDefault()
      // An anchor on the page (a one-page Showcase's menu) scrolls to its section.
      const anchor = /^#([A-Za-z][\w-]*)$/.exec(a.getAttribute('href') ?? '')?.[1]
      if (anchor) return void document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      let path = ''
      try {
        const u = new URL(a.getAttribute('href') ?? '', window.location.origin)
        if (u.origin === window.location.origin) path = u.pathname
      } catch {}
      const hit = PAGE_OF.find(([re]) => re.test(path))
      if (!hit) return
      const [, page, instead] = hit
      send({ event: 'open', page: `${audience}:${instead && !has.has(`${audience}:${page}`) ? instead : page}` })
    }
    const onSubmit = (e: Event) => e.preventDefault()
    const mover = arranger(() => arrange && !picking)
    window.addEventListener('message', onMessage)
    window.addEventListener('click', onClick, true)
    window.addEventListener('submit', onSubmit, true)
    send({ event: 'ready' })
    return () => {
      mover.dispose()
      window.removeEventListener('message', onMessage)
      window.removeEventListener('click', onClick, true)
      window.removeEventListener('submit', onSubmit, true)
    }
  }, [audience, planned])
  return null
}

/** The drag handle, drop line and 'move' message for arranging sections; `on` says whether arranging is allowed now. */
function arranger(on: () => boolean) {
  const blockOf = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>('[data-studio-block]') : null)
  const part = (css: string) => {
    const el = document.createElement('div')
    el.style.cssText = `position:fixed;z-index:2147483000;display:none;${css}`
    document.body.appendChild(el)
    return el
  }
  const handle = part('cursor:grab;touch-action:none;user-select:none;padding:5px 9px;border-radius:999px;font:600 12px/1.2 system-ui,sans-serif;color:#fff;background:#c46a46;box-shadow:0 1px 4px rgba(0,0,0,.3)')
  handle.textContent = '↕ Move'
  handle.title = 'Drag to move this section'
  handle.setAttribute('aria-hidden', 'true')
  const line = part('height:4px;border-radius:2px;pointer-events:none;background:#c46a46;box-shadow:0 0 0 2px rgba(255,255,255,.85)')
  const ghost = part('pointer-events:none;padding:5px 9px;border-radius:7px;font:500 12px/1.2 system-ui,sans-serif;color:#fff;background:rgba(27,23,20,.9);white-space:nowrap')
  let hovered: HTMLElement | null = null
  let drag: { el: HTMLElement; target: HTMLElement | null; place: 'before' | 'after'; x: number; y: number; raf: number; pointer: number } | null = null

  const place = () => {
    if (!hovered?.isConnected || !on()) {
      hovered = null
      handle.style.display = 'none'
      return
    }
    const r = hovered.getBoundingClientRect()
    handle.style.display = 'block'
    handle.style.left = `${Math.max(4, r.left + 10)}px`
    handle.style.top = `${Math.min(Math.max(4, r.top + 10), Math.max(4, r.bottom - 34))}px`
  }
  const update = () => {
    if (!drag) return
    const under = document.elementsFromPoint(drag.x, drag.y).find(n => n !== handle)
    const b = under ? blockOf(under) : null
    const target = b && b !== drag.el && b.dataset.studioPage === drag.el.dataset.studioPage ? b : null
    drag.target = target
    if (!target) return void (line.style.display = 'none')
    const r = target.getBoundingClientRect()
    drag.place = drag.y < r.top + r.height / 2 ? 'before' : 'after'
    line.style.display = 'block'
    line.style.left = `${r.left}px`
    line.style.width = `${r.width}px`
    line.style.top = `${(drag.place === 'before' ? r.top : r.bottom) - 2}px`
  }
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
  const stop = () => {
    if (!drag) return
    cancelAnimationFrame(drag.raf)
    drag.el.style.opacity = ''
    if (handle.hasPointerCapture(drag.pointer)) handle.releasePointerCapture(drag.pointer)
    drag = null
    document.documentElement.style.cursor = ''
    line.style.display = 'none'
    ghost.style.display = 'none'
    hovered = null
    place()
  }
  const onOver = (e: PointerEvent) => {
    if (drag || !on() || e.target === handle) return
    const b = blockOf(e.target)
    if (b !== hovered) {
      hovered = b
      place()
    }
  }
  const onMove = (e: PointerEvent) => {
    if (!drag) return
    drag.x = e.clientX
    drag.y = e.clientY
    ghost.style.left = `${e.clientX + 14}px`
    ghost.style.top = `${e.clientY + 14}px`
    update()
  }
  const onDown = (e: PointerEvent) => {
    if (!hovered || !on() || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    handle.setPointerCapture(e.pointerId)
    drag = { el: hovered, target: null, place: 'after', x: e.clientX, y: e.clientY, raf: 0, pointer: e.pointerId }
    hovered.style.opacity = '0.45'
    document.documentElement.style.cursor = 'grabbing'
    handle.style.display = 'none'
    ghost.textContent = `Moving ${hovered.dataset.studioLabel || 'section'}`
    ghost.style.display = 'block'
    drag.raf = requestAnimationFrame(tick)
    onMove(e)
  }
  const onUp = () => {
    const d = drag
    stop()
    if (d?.target) send({ event: 'move', page: d.el.dataset.studioPage, blockId: d.el.dataset.studioBlock, target: d.target.dataset.studioBlock, place: d.place })
  }
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && stop()
  const onScroll = () => (drag ? update() : place())
  const onLeave = () => {
    if (drag) return
    hovered = null
    place()
  }
  document.addEventListener('pointerover', onOver)
  document.documentElement.addEventListener('pointerleave', onLeave)
  handle.addEventListener('pointerdown', onDown)
  handle.addEventListener('pointermove', onMove)
  handle.addEventListener('pointerup', onUp)
  handle.addEventListener('pointercancel', stop)
  window.addEventListener('keydown', onKey)
  window.addEventListener('scroll', onScroll, true)
  return {
    /** Arranging was switched on or off. */
    refresh: () => {
      if (!on()) stop()
      place()
    },
    dispose: () => {
      stop()
      document.removeEventListener('pointerover', onOver)
      document.documentElement.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      handle.remove()
      line.remove()
      ghost.remove()
    },
  }
}
