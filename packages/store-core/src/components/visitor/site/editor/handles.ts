import { clampDeg } from '@/lib/site/code/free'
import { guidesFor, snapMove, snapResize, type Box, type Handle } from '@/lib/site/code/snap'

// Move and resize handles for a free layer on the editor's canvas (docs/plans/SITE_EDITOR_PLAN.md phase 3), built on
// pointer events. Positions are % of the layer's frame (its offsetParent); edges snap to the frame's edges, centre and
// fractions and to the other boxes in the frame (lib/site/code/snap.ts), with guides drawn while they hold. The drag
// shows through inline styles; the editor writes the classes and the reload after the save draws them for real.
// A rotate knob above the layer turns it (15° steps, Shift for 1°); a rotated layer is measured and resized in its
// unrotated box. Kept behind LayerHandles so a library could stand in.

export interface HandleOptions {
  sized: boolean
  onCommit: (box: Box, sized: boolean) => void
  /** Gets the new rotation in whole degrees (-180..180) when a rotate drag ends. */
  onRotate?: (deg: number) => void
}

export interface LayerHandles {
  /** Handles on a free layer; `onCommit` gets its box in % when a drag or nudge ends (`sized`: its height is set). */
  attach(el: HTMLElement, opts: HandleOptions): void
  detach(): void
  /** Follows the layer after the page scrolled or reflowed. */
  refresh(): void
  /** Moves the layer by whole percents (arrow keys). */
  nudge(dx: number, dy: number): void
  /** Resizes the layer by whole percents (Alt + arrow keys); a height change sets its height. */
  resize(dw: number, dh: number): void
  /** The element under the handles, if any. */
  readonly target: HTMLElement | null
}

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const CURSOR: Record<Handle, string> = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' }
const SNAP_PX = 6
const ROTATE_GAP = 22
const HANDLE_LABEL: Record<Handle, string> = {
  n: 'Resize from the top',
  s: 'Resize from the bottom',
  e: 'Resize from the right',
  w: 'Resize from the left',
  ne: 'Resize from the top right corner',
  nw: 'Resize from the top left corner',
  se: 'Resize from the bottom right corner',
  sw: 'Resize from the bottom left corner',
}
const ACCENT = 'rgb(var(--c-accent-500, 99 102 241))'

/** The frame's padding box in viewport px. */
function frameBox(frame: HTMLElement) {
  const r = frame.getBoundingClientRect()
  return { x: r.left + frame.clientLeft, y: r.top + frame.clientTop, w: frame.clientWidth || r.width, h: frame.clientHeight || r.height }
}

/** An element's own rotation in degrees (0 when it has none). */
export function rotationOf(el: Element): number {
  const t = el.ownerDocument.defaultView?.getComputedStyle(el).transform
  const m = t ? /^matrix\(([^)]+)\)$/.exec(t) : null
  if (!m) return 0
  const [a, b] = m[1].split(',').map(Number)
  const deg = (Math.atan2(b, a) * 180) / Math.PI
  return Math.abs(deg) < 0.01 || !Number.isFinite(deg) ? 0 : deg
}

const turn = (x: number, y: number, deg: number) => {
  const a = (deg * Math.PI) / 180
  return { x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) }
}

/** An element's box in % of a frame (its margin edge, which left and top place); a rotated one by its unrotated size. */
export function boxIn(el: HTMLElement, frame: HTMLElement): Box {
  const f = frameBox(frame)
  const r = el.getBoundingClientRect()
  const cs = el.ownerDocument.defaultView?.getComputedStyle(el)
  const ml = parseFloat(cs?.marginLeft ?? '0') || 0
  const mt = parseFloat(cs?.marginTop ?? '0') || 0
  const fr = rotationOf(frame)
  if (fr || rotationOf(el)) {
    // Its centre in the frame's own (unrotated) space, then its offset size around that.
    const fb = frame.getBoundingClientRect()
    const c = turn(r.left + r.width / 2 - (fb.left + fb.width / 2), r.top + r.height / 2 - (fb.top + fb.height / 2), -fr)
    const w = el.offsetWidth
    const h = el.offsetHeight
    return { left: ((f.w / 2 + c.x - w / 2 - ml) / f.w) * 100, top: ((f.h / 2 + c.y - h / 2 - mt) / f.h) * 100, width: (w / f.w) * 100, height: (h / f.h) * 100 }
  }
  return { left: ((r.left - ml - f.x) / f.w) * 100, top: ((r.top - mt - f.y) / f.h) * 100, width: (r.width / f.w) * 100, height: (r.height / f.h) * 100 }
}

export function createHandles(doc: Document): LayerHandles {
  let el: HTMLElement | null = null
  let opts: HandleOptions | null = null
  let root: HTMLDivElement | null = null
  let outline: HTMLDivElement | null = null
  let lines: HTMLDivElement | null = null
  let spin: HTMLDivElement | null = null
  const knobs = new Map<Handle, HTMLDivElement>()
  let drag: { handle: Handle | 'move' | 'rotate'; x: number; y: number; start: Box; moved: boolean; pointer: number; last?: Box; deg?: number } | null = null

  const frameOf = (e: HTMLElement) => (e.offsetParent instanceof HTMLElement ? e.offsetParent : e.parentElement) ?? doc.body
  const div = (style: string) => {
    const d = doc.createElement('div')
    d.setAttribute('style', style)
    return d
  }

  const place = () => {
    if (!el || !outline) return
    const r = el.getBoundingClientRect()
    const deg = rotationOf(el)
    // A rotated layer is outlined as its unrotated box, turned about its centre.
    const w = deg ? el.offsetWidth : r.width
    const h = deg ? el.offsetHeight : r.height
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    Object.assign(outline.style, { left: `${cx - w / 2}px`, top: `${cy - h / 2}px`, width: `${w}px`, height: `${h}px`, transform: deg ? `rotate(${deg}deg)` : '' })
    const at = (x: number, y: number) => {
      const p = turn(x - w / 2, y - h / 2, deg)
      return { left: `${cx + p.x - 5}px`, top: `${cy + p.y - 5}px` }
    }
    for (const [handle, k] of knobs) {
      const x = handle.includes('w') ? 0 : handle.includes('e') ? w : w / 2
      const y = handle.includes('n') ? 0 : handle.includes('s') ? h : h / 2
      Object.assign(k.style, at(x, y))
    }
    if (spin) Object.assign(spin.style, at(w / 2, -ROTATE_GAP))
  }

  const drawLines = (frame: HTMLElement, xs: number[], ys: number[]) => {
    if (!lines || rotationOf(frame)) return
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

  const onDown = (handle: Handle | 'move' | 'rotate') => (e: PointerEvent) => {
    if (!el || e.button !== 0 || (handle === 'move' && e.shiftKey) || el.isContentEditable) return
    e.preventDefault()
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    drag = { handle, x: e.clientX, y: e.clientY, start: boxIn(el, frameOf(el)), moved: false, pointer: e.pointerId }
  }
  const onMove = (e: PointerEvent) => {
    if (!drag || !el || e.pointerId !== drag.pointer) return
    const frame = frameOf(el)
    const f = frameBox(frame)
    const fr = rotationOf(frame)
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 3) return
    drag.moved = true
    if (drag.handle === 'rotate') {
      // The angle from the layer's centre to the pointer, 0 straight up; the knob sits above the layer.
      const r = el.getBoundingClientRect()
      const raw = (Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180) / Math.PI + 90 - fr
      const deg = clampDeg(e.shiftKey ? raw : Math.round(raw / 15) * 15)
      drag.deg = deg
      el.style.transform = deg ? `rotate(${deg}deg)` : 'none'
      return place()
    }
    // Pointer movement in the frame's own (unrotated) space; a resize in the layer's own as well.
    const local = turn(e.clientX - drag.x, e.clientY - drag.y, drag.handle === 'move' ? -fr : -(fr + rotationOf(el)))
    const dx = (local.x / f.w) * 100
    const dy = (local.y / f.h) * 100
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
    if (d.handle === 'rotate') {
      if (d.deg !== undefined) opts.onRotate?.(d.deg)
      return
    }
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
        k.setAttribute('role', 'button')
        k.setAttribute('aria-label', HANDLE_LABEL[h])
        k.addEventListener('pointerdown', onDown(h))
        knobs.set(h, k)
        root.append(k)
      }
      if (opts.onRotate) {
        spin = div(`position:fixed;width:10px;height:10px;box-sizing:border-box;background:${ACCENT};border:1.5px solid #fff;border-radius:50%;pointer-events:auto;cursor:grab;touch-action:none`)
        spin.setAttribute('data-e-overlay', '')
        spin.setAttribute('role', 'button')
        spin.setAttribute('aria-label', 'Rotate (15 degree steps, hold Shift for 1 degree)')
        spin.addEventListener('pointerdown', onDown('rotate'))
        root.append(spin)
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
      root = outline = lines = spin = null
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
    resize(dw, dh) {
      if (!el || !opts) return
      const b = boxIn(el, frameOf(el))
      const next = { ...b, width: Math.max(2, Math.round(b.width + dw)), height: Math.max(2, Math.round(b.height + dh)) }
      const sized = opts.sized || dh !== 0
      opts.sized = sized
      show(next, sized)
      opts.onCommit(next, sized)
    },
  }
  return api
}
