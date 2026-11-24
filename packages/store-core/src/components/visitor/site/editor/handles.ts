import { guidesFor, snapMove, snapResize, type Box, type Handle } from '@/lib/site/code/snap'

// Move and resize handles for a free layer on the editor's canvas (docs/plans/SITE_EDITOR_PLAN.md phase 3), built on
// pointer events. Positions are % of the layer's frame (its offsetParent); edges snap to the frame's edges, centre and
// fractions and to the other boxes in the frame (lib/site/code/snap.ts), with guides drawn while they hold. The drag
// shows through inline styles; the editor writes the classes and the reload after the save draws them for real.
// Kept behind LayerHandles so a library could stand in.

export interface LayerHandles {
  /** Handles on a free layer; `onCommit` gets its box in % when a drag or nudge ends (`sized`: its height is set). */
  attach(el: HTMLElement, opts: { sized: boolean; onCommit: (box: Box, sized: boolean) => void }): void
  detach(): void
  /** Follows the layer after the page scrolled or reflowed. */
  refresh(): void
  /** Moves the layer by whole percents (arrow keys). */
  nudge(dx: number, dy: number): void
  /** The element under the handles, if any. */
  readonly target: HTMLElement | null
}

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const CURSOR: Record<Handle, string> = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' }
const SNAP_PX = 6
const ACCENT = 'rgb(var(--c-accent-500, 99 102 241))'

/** The frame's padding box in viewport px. */
function frameBox(frame: HTMLElement) {
  const r = frame.getBoundingClientRect()
  return { x: r.left + frame.clientLeft, y: r.top + frame.clientTop, w: frame.clientWidth || r.width, h: frame.clientHeight || r.height }
}

/** An element's box in % of a frame (its margin edge, which left and top place). */
export function boxIn(el: HTMLElement, frame: HTMLElement): Box {
  const f = frameBox(frame)
  const r = el.getBoundingClientRect()
  const cs = el.ownerDocument.defaultView?.getComputedStyle(el)
  const ml = parseFloat(cs?.marginLeft ?? '0') || 0
  const mt = parseFloat(cs?.marginTop ?? '0') || 0
  return { left: ((r.left - ml - f.x) / f.w) * 100, top: ((r.top - mt - f.y) / f.h) * 100, width: (r.width / f.w) * 100, height: (r.height / f.h) * 100 }
}

export function createHandles(doc: Document): LayerHandles {
  let el: HTMLElement | null = null
  let opts: { sized: boolean; onCommit: (box: Box, sized: boolean) => void } | null = null
  let root: HTMLDivElement | null = null
  let outline: HTMLDivElement | null = null
  let lines: HTMLDivElement | null = null
  const knobs = new Map<Handle, HTMLDivElement>()
  let drag: { handle: Handle | 'move'; x: number; y: number; start: Box; moved: boolean; pointer: number; last?: Box } | null = null

  const frameOf = (e: HTMLElement) => (e.offsetParent instanceof HTMLElement ? e.offsetParent : e.parentElement) ?? doc.body
  const div = (style: string) => {
    const d = doc.createElement('div')
    d.setAttribute('style', style)
    return d
  }

  const place = () => {
    if (!el || !outline) return
    const r = el.getBoundingClientRect()
    Object.assign(outline.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` })
    for (const [h, k] of knobs) {
      const x = h.includes('w') ? 0 : h.includes('e') ? r.width : r.width / 2
      const y = h.includes('n') ? 0 : h.includes('s') ? r.height : r.height / 2
      Object.assign(k.style, { left: `${r.left + x - 5}px`, top: `${r.top + y - 5}px` })
    }
  }

  const drawLines = (frame: HTMLElement, xs: number[], ys: number[]) => {
    if (!lines) return
    const f = frameBox(frame)
    lines.replaceChildren(
      ...xs.map(x => div(`position:fixed;left:${f.x + (x / 100) * f.w}px;top:${f.y}px;width:1px;height:${f.h}px;background:${ACCENT}`)),
      ...ys.map(y => div(`position:fixed;left:${f.x}px;top:${f.y + (y / 100) * f.h}px;width:${f.w}px;height:1px;background:${ACCENT}`))
    )
  }

  const show = (box: Box, sized: boolean) => {
    if (!el) return
    Object.assign(el.style, { left: `${box.left}%`, top: `${box.top}%`, width: `${box.width}%`, ...(sized ? { height: `${box.height}%` } : {}) })
    place()
  }

  const others = (frame: HTMLElement) =>
    [...frame.children]
      .filter((c): c is HTMLElement => c instanceof HTMLElement && c !== el && !c.contains(el) && c.getBoundingClientRect().width > 0)
      .map(c => boxIn(c, frame))

  const onDown = (handle: Handle | 'move') => (e: PointerEvent) => {
    if (!el || e.button !== 0 || el.isContentEditable) return
    e.preventDefault()
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    drag = { handle, x: e.clientX, y: e.clientY, start: boxIn(el, frameOf(el)), moved: false, pointer: e.pointerId }
  }
  const onMove = (e: PointerEvent) => {
    if (!drag || !el || e.pointerId !== drag.pointer) return
    const frame = frameOf(el)
    const f = frameBox(frame)
    const dx = ((e.clientX - drag.x) / f.w) * 100
    const dy = ((e.clientY - drag.y) / f.h) * 100
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 3) return
    drag.moved = true
    const s = drag.start
    const guides = guidesFor(others(frame))
    const tol = (SNAP_PX / f.w) * 100
    const h = drag.handle
    const raw: Box =
      h === 'move'
        ? { ...s, left: s.left + dx, top: s.top + dy }
        : {
            left: h.includes('w') ? s.left + dx : s.left,
            top: h.includes('n') ? s.top + dy : s.top,
            width: h.includes('e') ? s.width + dx : h.includes('w') ? s.width - dx : s.width,
            height: h.includes('s') ? s.height + dy : h.includes('n') ? s.height - dy : s.height,
          }
    const snapped = h === 'move' ? snapMove(raw, guides, tol) : snapResize(raw, h, guides, tol)
    drag.last = snapped.box
    show(snapped.box, (opts?.sized ?? false) || (h !== 'move' && /[ns]/.test(h)))
    drawLines(frame, snapped.lines.x, snapped.lines.y)
  }
  const onUp = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointer) return
    const d = drag
    drag = null
    lines?.replaceChildren()
    if (!d.moved || !el || !opts) return
    const sized = opts.sized || (d.handle !== 'move' && /[ns]/.test(d.handle))
    opts.sized = sized
    opts.onCommit(d.last ?? boxIn(el, frameOf(el)), sized)
  }
  const onBody = onDown('move')

  const api: LayerHandles = {
    get target() {
      return el
    },
    attach(next, o) {
      if (el === next) return void (opts = { ...o }, place())
      api.detach()
      el = next
      opts = { ...o }
      root = div('position:fixed;inset:0;pointer-events:none;z-index:2147483646')
      root.setAttribute('data-e-overlay', '')
      outline = div(`position:fixed;box-sizing:border-box;border:1px solid ${ACCENT};pointer-events:none`)
      lines = div('position:fixed;inset:0;pointer-events:none')
      root.append(lines, outline)
      for (const h of HANDLES) {
        const k = div(`position:fixed;width:10px;height:10px;box-sizing:border-box;background:#fff;border:1.5px solid ${ACCENT};border-radius:2px;pointer-events:auto;cursor:${CURSOR[h]};touch-action:none`)
        k.setAttribute('data-e-overlay', '')
        k.addEventListener('pointerdown', onDown(h))
        knobs.set(h, k)
        root.append(k)
      }
      doc.body.append(root)
      el.addEventListener('pointerdown', onBody)
      el.style.cursor = 'move'
      el.style.touchAction = 'none'
      doc.addEventListener('pointermove', onMove, true)
      doc.addEventListener('pointerup', onUp, true)
      doc.addEventListener('pointercancel', onUp, true)
      place()
    },
    detach() {
      if (el) {
        el.removeEventListener('pointerdown', onBody)
        el.style.cursor = ''
        el.style.touchAction = ''
      }
      doc.removeEventListener('pointermove', onMove, true)
      doc.removeEventListener('pointerup', onUp, true)
      doc.removeEventListener('pointercancel', onUp, true)
      root?.remove()
      root = outline = lines = null
      knobs.clear()
      el = null
      opts = null
      drag = null
    },
    refresh: place,
    nudge(dx, dy) {
      if (!el || !opts) return
      const b = boxIn(el, frameOf(el))
      const next = { ...b, left: Math.round(b.left + dx), top: Math.round(b.top + dy) }
      show(next, opts.sized)
      opts.onCommit(next, opts.sized)
    },
  }
  return api
}
