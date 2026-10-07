import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import ContentGuard, { isCaptureCombo } from '@/components/vault/ContentGuard'

const wm = { buyer: 'buyer@example.com', store: 'Acme', reference: 'ORD-42', timestamp: '2026-10-07T00:00:00Z' }

function mount(props: { idleMs?: number; releaseMs?: number } = {}) {
  return render(
    <ContentGuard watermark={wm} {...props}>
      <p>secret page</p>
    </ContentGuard>
  )
}

function dispatch(type: string, init: any = {}, target: EventTarget = document) {
  const e = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(e, init)
  act(() => void target.dispatchEvent(e))
  return e
}

function key(type: 'keydown' | 'keyup', init: KeyboardEventInit) {
  const e = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init })
  act(() => void document.dispatchEvent(e))
  return e
}

const hidden = () => screen.queryByText('Content hidden') !== null

beforeEach(() => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('ContentGuard', () => {
  it('blocks copy/cut/paste/selection/contextmenu/drag', () => {
    mount()
    for (const t of ['copy', 'cut', 'paste', 'selectstart', 'contextmenu', 'dragstart']) {
      expect(dispatch(t).defaultPrevented, t).toBe(true)
    }
  })

  it('blocks Ctrl/Cmd + S/P/C/A/U but not other keys', () => {
    mount()
    for (const k of ['s', 'p', 'c', 'a', 'U']) {
      expect(key('keydown', { key: k, ctrlKey: true }).defaultPrevented, k).toBe(true)
    }
    expect(key('keydown', { key: 's', metaKey: true }).defaultPrevented).toBe(true)
    expect(key('keydown', { key: 'j', ctrlKey: true }).defaultPrevented).toBe(false)
  })

  it('obscures content on window blur and restores on focus', () => {
    mount()
    expect(hidden()).toBe(false)
    act(() => void window.dispatchEvent(new Event('blur')))
    expect(hidden()).toBe(true)
    act(() => void window.dispatchEvent(new Event('focus')))
    expect(hidden()).toBe(false)
  })

  it('obscures when the page is hidden and when the pointer leaves the document', () => {
    mount()
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    dispatch('visibilitychange')
    expect(hidden()).toBe(true)
    vis.mockReturnValue('visible')
    dispatch('visibilitychange')
    expect(hidden()).toBe(false)

    dispatch('mouseleave', {}, document.documentElement)
    expect(hidden()).toBe(true)
    dispatch('mouseenter', {}, document.documentElement)
    expect(hidden()).toBe(false)
  })

  it('obscures on PrintScreen', () => {
    mount()
    fireEvent.keyUp(document, { key: 'PrintScreen' })
    expect(hidden()).toBe(true)
  })

  it('hides immediately on Cmd+Shift (before the 3/4/5 key) and reveals ~800ms after all modifiers are up', () => {
    vi.useFakeTimers()
    mount()
    key('keydown', { key: 'Shift', metaKey: true, shiftKey: true })
    expect(hidden()).toBe(true)

    // Shift released but Cmd still held: stays hidden.
    key('keyup', { key: 'Shift', metaKey: true })
    act(() => void vi.advanceTimersByTime(2000))
    expect(hidden()).toBe(true)

    key('keyup', { key: 'Meta' })
    act(() => void vi.advanceTimersByTime(700))
    expect(hidden()).toBe(true)
    act(() => void vi.advanceTimersByTime(200))
    expect(hidden()).toBe(false)
  })

  it('hides on Win+Shift (Meta keydown with shift) and stays hidden while the window lacks focus', () => {
    vi.useFakeTimers()
    mount()
    key('keydown', { key: 'Meta', metaKey: true, shiftKey: true })
    expect(hidden()).toBe(true)
    vi.mocked(document.hasFocus).mockReturnValue(false)
    key('keyup', { key: 'Meta' })
    act(() => void vi.advanceTimersByTime(1000))
    expect(hidden()).toBe(true)

    vi.mocked(document.hasFocus).mockReturnValue(true)
    act(() => void window.dispatchEvent(new Event('focus')))
    act(() => void vi.advanceTimersByTime(900))
    expect(hidden()).toBe(false)
  })

  it('a plain pointer move releases the capture hide when the OS swallowed the keyup', () => {
    vi.useFakeTimers()
    mount()
    key('keydown', { key: 'Shift', metaKey: true, shiftKey: true })
    dispatch('mousemove', { metaKey: false, shiftKey: false })
    act(() => void vi.advanceTimersByTime(900))
    expect(hidden()).toBe(false)
  })

  it('classifies capture shortcuts', () => {
    expect(isCaptureCombo({ key: '4', metaKey: true, shiftKey: true, ctrlKey: false })).toBe(true)
    expect(isCaptureCombo({ key: 'Meta', metaKey: false, shiftKey: true, ctrlKey: false })).toBe(true)
    expect(isCaptureCombo({ key: 'p', metaKey: false, shiftKey: false, ctrlKey: true })).toBe(true)
    expect(isCaptureCombo({ key: 'PrintScreen', metaKey: false, shiftKey: false, ctrlKey: false })).toBe(true)
    expect(isCaptureCombo({ key: 'k', metaKey: true, shiftKey: false, ctrlKey: false })).toBe(false)
    expect(isCaptureCombo({ key: 'S', metaKey: false, shiftKey: true, ctrlKey: false })).toBe(false)
  })

  it('blurs paused content after the idle window and reveals on the next interaction', () => {
    vi.useFakeTimers()
    render(
      <ContentGuard watermark={wm} idleMs={60_000}>
        <video data-testid="v" />
      </ContentGuard>
    )
    act(() => void vi.advanceTimersByTime(59_000))
    expect(hidden()).toBe(false)
    act(() => void vi.advanceTimersByTime(1_500))
    expect(hidden()).toBe(true)
    dispatch('pointerdown')
    expect(hidden()).toBe(false)
  })

  it('never idles while media is playing', () => {
    vi.useFakeTimers()
    const { container } = render(
      <ContentGuard watermark={wm} idleMs={60_000}>
        <video data-testid="v" />
      </ContentGuard>
    )
    Object.defineProperty(container.querySelector('video')!, 'paused', { get: () => false })
    act(() => void vi.advanceTimersByTime(300_000))
    expect(hidden()).toBe(false)
  })

  it('renders the drifting identity watermark with order reference, a print-hide rule, and the limits note', () => {
    const { container } = mount()
    expect(screen.getAllByText(/buyer@example\.com · #ORD-42 · Acme · 2026-10-07/).length).toBeGreaterThan(1)
    const wmLayer = container.querySelector('[data-vault-watermark]') as HTMLElement
    expect(wmLayer.className).toMatch(/z-40/)
    expect(wmLayer.textContent).toBeTruthy()
    expect(container.innerHTML).toMatch(/vault-wm-drift/)
    expect(container.querySelector('style')?.textContent).toMatch(/@media print[\s\S]*vault-protected[\s\S]*display: none/)
    expect(screen.getByText(/can't fully block screenshots/)).toBeTruthy()
  })

  it('fullscreens the guard container (watermark included), not the media element', () => {
    const { container } = mount()
    const box = container.querySelector('.vault-protected') as HTMLElement
    const req = vi.fn(async () => {})
    ;(box as any).requestFullscreen = req
    fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' }))
    expect(req).toHaveBeenCalled()
  })

  it('falls back to a fixed full-viewport layer without the Fullscreen API', () => {
    const { container } = mount()
    const box = container.querySelector('.vault-protected') as HTMLElement
    ;(box as any).requestFullscreen = undefined
    fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' }))
    expect(box.className).toMatch(/fixed inset-0/)
    expect(box.querySelector('[data-vault-watermark]')).toBeTruthy()
    key('keydown', { key: 'Escape' })
    expect(box.className).not.toMatch(/fixed inset-0/)
  })
})
