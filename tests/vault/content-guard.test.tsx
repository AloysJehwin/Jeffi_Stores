import { describe, it, expect } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import ContentGuard from '@/components/vault/ContentGuard'

const wm = { buyer: 'buyer@example.com', store: 'Acme', timestamp: '2026-10-07T00:00:00.000Z' }

function mount() {
  return render(
    <ContentGuard watermark={wm}>
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

describe('ContentGuard', () => {
  it('blocks copy/cut/paste/selection/contextmenu/drag', () => {
    mount()
    for (const t of ['copy', 'cut', 'paste', 'selectstart', 'contextmenu', 'dragstart']) {
      expect(dispatch(t).defaultPrevented, t).toBe(true)
    }
  })

  it('blocks Ctrl/Cmd + S/P/C/A/U but not other keys', () => {
    mount()
    for (const key of ['s', 'p', 'c', 'a', 'U']) {
      const e = new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true })
      act(() => void document.dispatchEvent(e))
      expect(e.defaultPrevented, key).toBe(true)
    }
    const meta = new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true, cancelable: true })
    act(() => void document.dispatchEvent(meta))
    expect(meta.defaultPrevented).toBe(true)
    const plain = new KeyboardEvent('keydown', { key: 'j', ctrlKey: true, bubbles: true, cancelable: true })
    act(() => void document.dispatchEvent(plain))
    expect(plain.defaultPrevented).toBe(false)
  })

  it('obscures content on window blur and restores on focus', () => {
    mount()
    expect(screen.queryByText('Content hidden')).toBeNull()
    act(() => void window.dispatchEvent(new Event('blur')))
    expect(screen.getByText('Content hidden')).toBeTruthy()
    act(() => void window.dispatchEvent(new Event('focus')))
    expect(screen.queryByText('Content hidden')).toBeNull()
  })

  it('obscures on PrintScreen', () => {
    mount()
    fireEvent.keyUp(document, { key: 'PrintScreen' })
    expect(screen.getByText('Content hidden')).toBeTruthy()
  })

  it('renders the identity watermark, a print-hide rule, and the honest limits note', () => {
    const { container } = mount()
    expect(screen.getAllByText(/buyer@example\.com · Acme · 2026-10-07/).length).toBeGreaterThan(1)
    expect(container.querySelector('style')?.textContent).toMatch(/@media print[\s\S]*vault-protected[\s\S]*display: none/)
    expect(screen.getByText(/cannot prevent operating-system screenshots/)).toBeTruthy()
  })
})
