import { describe, it, expect, vi } from 'vitest'
import { boxIn, createHandles } from '@/components/visitor/site/editor/handles'

// The canvas's move and resize handles on a free layer, with the layout faked (happy-dom has none): a frame 1000×500
// px and a layer at 100,50 sized 300×100, so 10%, 10%, 30% × 20%.

function scene() {
  const frame = document.createElement('div')
  const el = document.createElement('div')
  frame.append(el)
  document.body.append(frame)
  const rect = (left: number, top: number, width: number, height: number) => () => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect
  frame.getBoundingClientRect = rect(0, 0, 1000, 500)
  Object.defineProperty(frame, 'clientWidth', { value: 1000 })
  Object.defineProperty(frame, 'clientHeight', { value: 500 })
  el.getBoundingClientRect = rect(100, 50, 300, 100)
  return { frame, el }
}
const pointer = (type: string, target: EventTarget, x: number, y: number) =>
  target.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, pointerId: 1, bubbles: true, cancelable: true }))

describe('free layer handles', () => {
  it('measures a box in % of its frame', () => {
    const { frame, el } = scene()
    expect(boxIn(el, frame)).toEqual({ left: 10, top: 10, width: 30, height: 20 })
  })

  it('resizes from a handle, snapping its edge to the frame centre, and commits the box', () => {
    const { el } = scene()
    const onCommit = vi.fn()
    const h = createHandles(document)
    h.attach(el, { sized: false, onCommit })
    expect(h.target).toBe(el)
    const knobs = document.querySelectorAll('[data-e-overlay][style*="ew-resize"]')
    expect(knobs).toHaveLength(2)
    const east = [...knobs].find(k => (k as HTMLElement).style.left === `${100 + 300 - 5}px`)!
    pointer('pointerdown', east, 400, 100)
    pointer('pointermove', document, 495, 100)
    expect(el.style.width).toBe('40%')
    pointer('pointerup', document, 495, 100)
    expect(onCommit).toHaveBeenCalledWith({ left: 10, top: 10, width: 40, height: 20 }, false)
    h.detach()
    expect(document.querySelector('[data-e-overlay]')).toBeNull()
  })

  it('moves by dragging the layer, nudges by whole percents, and ignores a click', () => {
    const { el } = scene()
    const onCommit = vi.fn()
    const h = createHandles(document)
    h.attach(el, { sized: false, onCommit })
    pointer('pointerdown', el, 200, 100)
    pointer('pointerup', document, 201, 100)
    expect(onCommit).not.toHaveBeenCalled()
    pointer('pointerdown', el, 200, 100)
    pointer('pointermove', document, 323, 100)
    pointer('pointerup', document, 323, 100)
    expect(onCommit.mock.calls[0][0]).toMatchObject({ left: 22, top: 10 })
    h.nudge(-1, 2)
    expect(onCommit.mock.calls[1][0]).toMatchObject({ left: 9, top: 12 })
    h.detach()
  })
})
