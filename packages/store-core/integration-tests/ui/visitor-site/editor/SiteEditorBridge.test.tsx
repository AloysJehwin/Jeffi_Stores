import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'

const h = vi.hoisted(() => ({
  handles: { attach: vi.fn(), detach: vi.fn(), refresh: vi.fn(), nudge: vi.fn(), target: null as any },
  rich: { finish: vi.fn(), refresh: vi.fn() },
  mountRich: vi.fn(),
}))

vi.mock('@/components/visitor/site/editor/handles', () => ({
  createHandles: () => h.handles,
  boxIn: () => ({ left: 1, top: 2, width: 3, height: 4 }),
}))
vi.mock('@/components/visitor/site/editor/rich-text', () => ({ mountRich: h.mountRich }))
vi.mock('@jeffi/site-blocks/design', () => ({
  withBreakpoint: (_cur: string, _bp: unknown, value: string[]) => value.join(' '),
}))

import SiteEditorBridge from '@/components/visitor/site/editor/SiteEditorBridge'

// The bridge only runs inside the Site Builder iframe; a fake parent window stands in for the editor.
const parent = { postMessage: vi.fn() }
const realParent = Object.getOwnPropertyDescriptor(window, 'parent')

const fromEditor = (type: string, data: Record<string, unknown> = {}) =>
  act(() => {
    const e = new MessageEvent('message', { data: { type: `site-editor:${type}`, ...data } })
    Object.defineProperty(e, 'source', { value: parent })
    window.dispatchEvent(e)
  })
const sent = (type: string) => parent.postMessage.mock.calls.map(c => c[0]).filter(m => m.type === `site-editor:${type}`)

function page() {
  document.body.innerHTML = `
    <div data-block-id="b1" data-code-section="sec1">
      <div data-e="root" class="sec1">
        <h1 data-e="title" data-e-text class="text-xl sec1">Hello</h1>
        <img data-e="pic" src="/a.jpg" srcset="/a.jpg 1x" alt="old">
        <a data-e="cmp" data-e-cmp href="/x" class="part">Part link</a>
      </div>
    </div>
    <div data-block-id="b2"><p>Plain block</p></div>`
}

beforeEach(() => {
  parent.postMessage.mockClear()
  Object.values(h.handles).forEach(f => typeof f === 'function' && (f as any).mockClear?.())
  Object.defineProperty(window, 'parent', { value: parent, configurable: true })
  ;(window as any).__siteEditorBridge = false
  page()
})
afterEach(() => {
  if (realParent) Object.defineProperty(window, 'parent', realParent)
  document.documentElement.removeAttribute('data-site-editing')
})

const mount = () => render(<SiteEditorBridge />)
const on = (write = true) => fromEditor('mode', { on: true, write })

describe('SiteEditorBridge', () => {
  it('announces itself and renders its outline styles', () => {
    const { container } = mount()
    expect(sent('ready')).toHaveLength(1)
    expect(container.querySelector('style')!.textContent).toContain('data-e-selected')
  })

  it('does nothing outside an iframe', () => {
    Object.defineProperty(window, 'parent', { value: window, configurable: true })
    mount()
    expect(parent.postMessage).not.toHaveBeenCalled()
  })

  it('is dormant until the editor switches it on: clicks behave normally', () => {
    mount()
    const notPrevented = fireEvent.click(document.querySelector('[data-e="title"]')!)
    expect(notPrevented).toBe(true)
    expect(sent('select')).toHaveLength(0)
  })

  it('selects the clicked element by node id once on, without following links', () => {
    mount()
    on()
    expect(document.documentElement).toHaveAttribute('data-site-editing')
    const notPrevented = fireEvent.click(document.querySelector('[data-e="title"]')!)
    expect(notPrevented).toBe(false)
    expect(sent('select')[0]).toMatchObject({ block: 'b1', id: 'title', tag: 'h1', cmp: false, text: 'Hello' })
    expect(document.querySelector('[data-e="title"]')).toHaveAttribute('data-e-selected')
  })

  it('reports a part (component) as cmp and offers no text to edit', () => {
    mount()
    on()
    fireEvent.click(document.querySelector('[data-e="cmp"]')!)
    expect(sent('select')[0]).toMatchObject({ id: 'cmp', cmp: true, text: null })
  })

  it('selects the whole block when the click lands outside code elements', () => {
    mount()
    on()
    fireEvent.click(document.querySelector('[data-block-id="b2"] p')!)
    expect(sent('select')[0]).toMatchObject({ block: 'b2', id: null })
    expect(document.querySelector('[data-block-id="b2"]')).toHaveAttribute('data-e-selected')
  })

  it('switching off clears the selection and the flag', () => {
    mount()
    on()
    fireEvent.click(document.querySelector('[data-e="title"]')!)
    fromEditor('mode', { on: false })
    expect(document.documentElement).not.toHaveAttribute('data-site-editing')
    expect(document.querySelector('[data-e-selected]')).toBeNull()
  })

  it('selects and scrolls to what the editor points at', () => {
    mount()
    fromEditor('select', { block: 'b1', id: 'pic' })
    expect(document.querySelector('[data-e="pic"]')).toHaveAttribute('data-e-selected')
    fromEditor('select', { block: 'b2' })
    expect(document.querySelector('[data-block-id="b2"]')).toHaveAttribute('data-e-selected')
    expect(document.querySelectorAll('[data-e-selected]')).toHaveLength(1)
  })

  it('edits text in place on double click and commits it with Enter as an operation', () => {
    mount()
    on()
    const title = document.querySelector('[data-e="title"]') as HTMLElement
    fireEvent.dblClick(title)
    expect(title).toHaveAttribute('contenteditable')
    title.textContent = 'Hello\nworld'
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(title).not.toHaveAttribute('contenteditable')
    expect(title.textContent).toBe('Hello world')
    expect(sent('ops')[0]).toEqual({ type: 'site-editor:ops', block: 'b1', ops: [{ op: 'text', id: 'title', value: 'Hello world' }] })
  })

  it('puts the old text back on Escape and sends nothing', () => {
    mount()
    on()
    const title = document.querySelector('[data-e="title"]') as HTMLElement
    fireEvent.dblClick(title)
    title.textContent = 'Changed'
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(title.textContent).toBe('Hello')
    expect(sent('ops')).toHaveLength(0)
  })

  it('does not edit elements whose words are not written out (parts, data)', () => {
    mount()
    on()
    const part = document.querySelector('[data-e="cmp"]')!
    fireEvent.dblClick(part)
    expect(part).not.toHaveAttribute('contenteditable')
  })

  describe('rich text', () => {
    const rich = () => {
      document.querySelector('[data-block-id="b1"] > div')!.insertAdjacentHTML(
        'beforeend',
        `<p data-e="para" data-e-rich>Hi <strong data-e="st" data-e-text>there</strong></p><p data-e="plainp" data-e-text>Words</p><div data-e="plaind" data-e-text>Div</div>`,
      )
      h.mountRich.mockReset()
      h.rich.finish.mockReset()
      h.mountRich.mockReturnValue(h.rich)
    }
    const loaded = () => act(async () => void (await new Promise(r => setTimeout(r, 0))))

    it('mounts the rich editor on a data-e-rich element, also from a double click on its inline child', async () => {
      rich()
      mount()
      on()
      fireEvent.dblClick(document.querySelector('[data-e="st"]')!)
      await loaded()
      expect(h.mountRich).toHaveBeenCalledTimes(1)
      expect(h.mountRich.mock.calls[0][0]).toBe(document.querySelector('[data-e="para"]'))
      expect(h.mountRich.mock.calls[0][1]).toBe(false)
      expect(document.querySelector('[data-e="para"]')).not.toHaveAttribute('contenteditable')
    })

    it('uses it on a text-only paragraph too, but not on a div', async () => {
      rich()
      mount()
      on()
      fireEvent.dblClick(document.querySelector('[data-e="plainp"]')!)
      await loaded()
      expect(h.mountRich).toHaveBeenCalledWith(document.querySelector('[data-e="plainp"]'), true)
      fireEvent.keyDown(document, { key: 'Escape' })
      h.mountRich.mockClear()
      fireEvent.dblClick(document.querySelector('[data-e="plaind"]')!)
      await loaded()
      expect(h.mountRich).not.toHaveBeenCalled()
      expect(document.querySelector('[data-e="plaind"]')).toHaveAttribute('contenteditable')
    })

    it('commits on Enter (not Shift+Enter) and reports its operations, with rich only for a node op', async () => {
      rich()
      mount()
      on()
      h.rich.finish.mockReturnValue({ ops: [{ op: 'node', id: 'para', node: {} }], rich: true })
      fireEvent.dblClick(document.querySelector('[data-e="para"]')!)
      await loaded()
      fireEvent.keyDown(document, { key: 'Enter', shiftKey: true })
      expect(h.rich.finish).not.toHaveBeenCalled()
      fireEvent.keyDown(document, { key: 'Enter' })
      expect(h.rich.finish).toHaveBeenCalledWith(true)
      expect(sent('ops')[0]).toEqual({ type: 'site-editor:ops', block: 'b1', ops: [{ op: 'node', id: 'para', node: {} }], rich: true })

      h.rich.finish.mockReturnValue({ ops: [{ op: 'text', id: 'plainp', value: 'x' }], rich: false })
      fireEvent.dblClick(document.querySelector('[data-e="plainp"]')!)
      await loaded()
      fireEvent.keyDown(document, { key: 'Enter' })
      expect(sent('ops')[1]).toEqual({ type: 'site-editor:ops', block: 'b1', ops: [{ op: 'text', id: 'plainp', value: 'x' }] })
    })

    it('cancels on Escape without reporting, and sends nothing when nothing changed', async () => {
      rich()
      mount()
      on()
      fireEvent.dblClick(document.querySelector('[data-e="para"]')!)
      await loaded()
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(h.rich.finish).toHaveBeenCalledWith(false)
      h.rich.finish.mockReturnValue(null)
      fireEvent.dblClick(document.querySelector('[data-e="para"]')!)
      await loaded()
      fireEvent.keyDown(document, { key: 'Enter' })
      expect(sent('ops')).toHaveLength(0)
    })

    it('leaves the keys to the toolbar while a field in it has focus', async () => {
      rich()
      mount()
      on()
      fireEvent.dblClick(document.querySelector('[data-e="para"]')!)
      await loaded()
      const bar = document.createElement('div')
      bar.setAttribute('data-e-overlay', '')
      bar.innerHTML = '<input />'
      document.body.appendChild(bar)
      fireEvent.keyDown(bar.querySelector('input')!, { key: 'Enter' })
      expect(h.rich.finish).not.toHaveBeenCalled()
      bar.remove()
    })

    it('a click elsewhere ends a rich edit that is still loading without mounting it', async () => {
      rich()
      mount()
      on()
      fireEvent.dblClick(document.querySelector('[data-e="para"]')!)
      fireEvent.click(document.querySelector('[data-e="title"]')!)
      await loaded()
      expect(h.mountRich).not.toHaveBeenCalled()
    })
  })

  it('sends undo, redo, delete and escape keys to the editor', () => {
    mount()
    on()
    const keys: [Partial<KeyboardEventInit>, string][] = [
      [{ key: 'z', ctrlKey: true }, 'undo'],
      [{ key: 'z', ctrlKey: true, shiftKey: true }, 'redo'],
      [{ key: 'y', metaKey: true }, 'redo'],
      [{ key: 'Delete' }, 'delete'],
      [{ key: 'Backspace' }, 'delete'],
      [{ key: 'Escape' }, 'escape'],
    ]
    for (const [init] of keys) fireEvent.keyDown(document, init)
    expect(sent('key').map(m => m.action)).toEqual(keys.map(k => k[1]))
    fireEvent.keyDown(document, { key: 'a' })
    expect(sent('key')).toHaveLength(keys.length)
  })

  it('nudges a selected free layer with the arrow keys, more with shift', () => {
    mount()
    on()
    h.handles.target = document.querySelector('[data-e="title"]')
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    expect(h.handles.nudge).toHaveBeenLastCalledWith(1, 0)
    fireEvent.keyDown(document, { key: 'ArrowUp', shiftKey: true })
    expect(h.handles.nudge).toHaveBeenLastCalledWith(0, -5)
    h.handles.target = null
  })

  it('shows text, class and picture operations at once and reports which it applied', () => {
    mount()
    fromEditor('apply', {
      block: 'b1',
      seq: 7,
      ops: [
        { op: 'text', id: 'title', value: 'New title' },
        { op: 'classes', id: 'title', bp: undefined, value: ['text-3xl'] },
        { op: 'attr', id: 'pic', name: 'src', value: '/b.jpg' },
        { op: 'attr', id: 'pic', name: 'alt', value: 'new alt' },
        { op: 'text', id: 'cmp', value: 'ignored for parts' },
        { op: 'delete', id: 'title' },
        { op: 'text', id: 'missing', value: 'x' },
      ],
    })
    const title = document.querySelector('[data-e="title"]')!
    expect(title.textContent).toBe('New title')
    expect(title.classList.contains('text-3xl')).toBe(true)
    expect(title.classList.contains('sec1')).toBe(true) // the section's own mark class is kept
    const pic = document.querySelector('[data-e="pic"]')!
    expect(pic).toHaveAttribute('src', '/b.jpg')
    expect(pic).not.toHaveAttribute('srcset')
    expect(pic).toHaveAttribute('alt', 'new alt')
    const applied = sent('applied')[0]
    expect(applied.seq).toBe(7)
    expect(applied.ops.map((o: any) => o.op)).toEqual(['text', 'classes', 'attr', 'attr'])
  })

  it('reports an element\'s box and frame when asked to measure', () => {
    mount()
    fromEditor('measure', { block: 'b1', id: 'title', req: 3 })
    const m = sent('measured')[0]
    expect(m.req).toBe(3)
    expect(m).toHaveProperty('rect')
    fromEditor('measure', { block: 'b1', id: 'nothing', req: 4 })
    expect(sent('measured')[1]).toMatchObject({ req: 4, rect: null })
  })

  it('places a layer with inline styles and clears them again', () => {
    mount()
    fromEditor('place', { block: 'b1', id: 'pic', rect: { left: 10, top: 20, width: 30, height: 40 } })
    const pic = document.querySelector('[data-e="pic"]') as HTMLElement
    expect(pic.style.position).toBe('absolute')
    expect(pic.style.left).toBe('10%')
    expect(pic.style.height).toBe('40%')
    fromEditor('place', { block: 'b1', id: 'pic', rect: null })
    expect(pic.style.position).toBe('')
    expect(pic.style.left).toBe('')
  })

  it('lights up what an AI change touched, then clears it', () => {
    vi.useFakeTimers()
    try {
      mount()
      fromEditor('flash', { block: 'b1', ids: ['title', 'pic'] })
      expect(document.querySelectorAll('[data-e-flash]')).toHaveLength(2)
      act(() => {
        vi.advanceTimersByTime(2700)
      })
      expect(document.querySelectorAll('[data-e-flash]')).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores messages from other windows and with other prefixes', () => {
    mount()
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'site-editor:mode', on: true } }))
    })
    expect(document.documentElement).not.toHaveAttribute('data-site-editing')
    act(() => {
      const e = new MessageEvent('message', { data: { type: 'other:mode', on: true } })
      Object.defineProperty(e, 'source', { value: parent })
      window.dispatchEvent(e)
    })
    expect(document.documentElement).not.toHaveAttribute('data-site-editing')
  })

  it('cleans up its listeners and flag on unmount', () => {
    const { unmount } = mount()
    on()
    unmount()
    expect(document.documentElement).not.toHaveAttribute('data-site-editing')
    expect(h.handles.detach).toHaveBeenCalled()
    expect((window as any).__siteEditorBridge).toBe(false)
    parent.postMessage.mockClear()
    fireEvent.click(document.querySelector('[data-e="title"]')!)
    expect(sent('select')).toHaveLength(0)
  })
})
