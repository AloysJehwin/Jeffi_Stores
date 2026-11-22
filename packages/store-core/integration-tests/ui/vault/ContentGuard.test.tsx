import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import ContentGuard, { isCaptureCombo } from '@/components/vault/ContentGuard'
import type { WatermarkInfo } from '@/components/vault/Watermark'

// Deterrence wrapper: renders children + watermark + the capture footer, and exposes isCaptureCombo,
// the pure predicate deciding which key states precede an OS screenshot shortcut.

const watermark: WatermarkInfo = { buyer: 'Asha Rao', store: 'Halo Audio', timestamp: '2026-11-22T10:00:00Z' }

describe('isCaptureCombo', () => {
  it('flags PrintScreen', () => {
    expect(isCaptureCombo({ key: 'PrintScreen', metaKey: false, shiftKey: false, ctrlKey: false })).toBe(true)
  })

  it('flags Cmd+Shift (macOS capture modifier)', () => {
    expect(isCaptureCombo({ key: '4', metaKey: true, shiftKey: true, ctrlKey: false })).toBe(true)
  })

  it('flags Win+Shift (Meta key down with shift)', () => {
    expect(isCaptureCombo({ key: 'Meta', metaKey: false, shiftKey: true, ctrlKey: false })).toBe(true)
  })

  it('flags Ctrl/Cmd + P (print)', () => {
    expect(isCaptureCombo({ key: 'p', metaKey: false, shiftKey: false, ctrlKey: true })).toBe(true)
    expect(isCaptureCombo({ key: 'P', metaKey: true, shiftKey: false, ctrlKey: false })).toBe(true)
  })

  it('does not flag a plain letter with no modifiers', () => {
    expect(isCaptureCombo({ key: 'a', metaKey: false, shiftKey: false, ctrlKey: false })).toBe(false)
  })
})

describe('ContentGuard (render)', () => {
  it('renders its children and the protected footer notice', () => {
    render(
      <ContentGuard watermark={watermark}>
        <div>protected body</div>
      </ContentGuard>
    )
    expect(screen.getByText('protected body')).toBeInTheDocument()
    expect(screen.getByText(/Watermarked with your identity/)).toBeInTheDocument()
  })

  it('exposes a fullscreen toggle and overlays the watermark layer', () => {
    const { container } = render(
      <ContentGuard watermark={watermark}>
        <div>protected body</div>
      </ContentGuard>
    )
    expect(screen.getByRole('button', { name: 'Fullscreen' })).toBeInTheDocument()
    expect(container.querySelector('[data-vault-watermark]')).not.toBeNull()
  })

  it('starts un-obscured (no reason) when focused and present', () => {
    // happy-dom reports document focus true, so the guard renders with data-obscured=false.
    const { container } = render(
      <ContentGuard watermark={watermark}>
        <div>protected body</div>
      </ContentGuard>
    )
    expect(container.querySelector('[data-obscured="false"]')).not.toBeNull()
  })
})
