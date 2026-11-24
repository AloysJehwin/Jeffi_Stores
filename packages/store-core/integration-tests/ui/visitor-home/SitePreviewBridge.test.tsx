import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'
import SitePreviewBridge from '@/components/visitor/home/SitePreviewBridge'

// The bridge only runs inside the Site Builder iframe (window.parent !== window); we fake a parent window and
// talk to it the way the editor does, through postMessage.

const parent = { postMessage: vi.fn() }
const realParent = Object.getOwnPropertyDescriptor(window, 'parent')

const fromEditor = (data: unknown) =>
  act(() => {
    const e = new MessageEvent('message', { data })
    Object.defineProperty(e, 'source', { value: parent })
    window.dispatchEvent(e)
  })

const sent = (type: string) => parent.postMessage.mock.calls.map(c => c[0]).filter(m => m.type === type)

function page() {
  document.body.innerHTML = `
    <div data-block-id="hero"><h2>Big banner</h2><img alt="Hero photo" src="/h.jpg"></div>
    <div data-block-id="about"><p>About text</p></div>
    <div data-site-page="header"><div data-block-id="logo"><span>Logo</span></div></div>`
}

beforeEach(() => {
  parent.postMessage.mockClear()
  Object.defineProperty(window, 'parent', { value: parent, configurable: true })
  ;(window as any).__siteBuilderBridge = false
  page()
})
afterEach(() => {
  if (realParent) Object.defineProperty(window, 'parent', realParent)
  document.documentElement.removeAttribute('data-site-picking')
})

describe('SitePreviewBridge', () => {
  it('renders the outline styles and announces itself to the editor', () => {
    const { container } = render(<SitePreviewBridge />)
    expect(container.querySelector('style')!.textContent).toContain('data-block-selected')
    expect(sent('site-builder:ready')).toHaveLength(1)
    expect(document.documentElement).toHaveAttribute('data-site-picking')
  })

  it('does nothing outside an iframe', () => {
    Object.defineProperty(window, 'parent', { value: window, configurable: true })
    render(<SitePreviewBridge />)
    expect(parent.postMessage).not.toHaveBeenCalled()
  })

  it('selects a clicked block without following the click, and sends what was pointed at', () => {
    render(<SitePreviewBridge />)
    const heading = document.querySelector('h2')!
    const notPrevented = fireEvent.click(heading)
    expect(notPrevented).toBe(false)
    const [msg] = sent('site-builder:select')
    expect(msg).toMatchObject({ id: 'hero', hint: 'Big banner', tag: 'h2', page: null })
    expect(document.querySelector('[data-block-id="hero"]')).toHaveAttribute('data-block-selected')
  })

  it('describes a clicked image by its alt text and tags chrome blocks with their page', () => {
    render(<SitePreviewBridge />)
    fireEvent.click(document.querySelector('img')!)
    expect(sent('site-builder:select')[0].hint).toBe('image: Hero photo')
    fireEvent.click(document.querySelector('span')!)
    expect(sent('site-builder:select')[1]).toMatchObject({ id: 'logo', page: 'header' })
  })

  it('ignores clicks outside any block', () => {
    render(<SitePreviewBridge />)
    document.body.insertAdjacentHTML('beforeend', '<button id="plain">plain</button>')
    const notPrevented = fireEvent.click(document.getElementById('plain')!)
    expect(notPrevented).toBe(true)
    expect(sent('site-builder:select')).toHaveLength(0)
  })

  it('highlights and clears a block when the editor asks, and ignores messages from other windows', () => {
    render(<SitePreviewBridge />)
    fromEditor({ type: 'site-builder:highlight', id: 'about' })
    expect(document.querySelector('[data-block-id="about"]')).toHaveAttribute('data-block-selected')
    fromEditor({ type: 'site-builder:highlight', id: 'hero' })
    expect(document.querySelectorAll('[data-block-selected]')).toHaveLength(1)
    fromEditor({ type: 'site-builder:highlight', id: null })
    expect(document.querySelectorAll('[data-block-selected]')).toHaveLength(0)
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'site-builder:highlight', id: 'about' } }))
    })
    expect(document.querySelectorAll('[data-block-selected]')).toHaveLength(0)
  })

  it('behaves like the live site when the editor turns the arrow tool off', () => {
    render(<SitePreviewBridge />)
    fromEditor({ type: 'site-builder:pick', on: false })
    expect(document.documentElement).not.toHaveAttribute('data-site-picking')
    const notPrevented = fireEvent.click(document.querySelector('h2')!)
    expect(notPrevented).toBe(true)
    expect(sent('site-builder:select')).toHaveLength(0)
    fromEditor({ type: 'site-builder:pick', on: true })
    expect(document.documentElement).toHaveAttribute('data-site-picking')
  })

  it('shows a move handle on a hovered block only when the editor allows dragging', () => {
    render(<SitePreviewBridge />)
    const handle = () => Array.from(document.body.children).find(el => (el as HTMLElement).textContent === '↕ Move') as HTMLElement
    fireEvent.pointerOver(document.querySelector('h2')!)
    expect(handle().style.display).toBe('none')
    fromEditor({ type: 'site-builder:pick', on: true, drag: true })
    fireEvent.pointerOver(document.querySelector('h2')!)
    expect(handle().style.display).toBe('block')
  })

  it('removes its floating parts and flag on unmount', () => {
    const { unmount } = render(<SitePreviewBridge />)
    expect(Array.from(document.body.children).some(el => (el as HTMLElement).textContent === '↕ Move')).toBe(true)
    unmount()
    expect(Array.from(document.body.children).some(el => (el as HTMLElement).textContent === '↕ Move')).toBe(false)
    expect((window as any).__siteBuilderBridge).toBe(false)
  })
})
