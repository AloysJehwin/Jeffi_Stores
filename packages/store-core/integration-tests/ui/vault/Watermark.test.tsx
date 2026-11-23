import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import Watermark, { watermarkLabel, type WatermarkInfo } from '@/components/vault/Watermark'

// Identity watermark overlay. watermarkLabel is the traceable string (buyer · #ref · store · time);
// the component tiles it + a drifting stamp. Proves the label format and that the layer is aria-hidden.

const info: WatermarkInfo = {
  buyer: 'Asha Rao',
  store: 'Halo Audio',
  timestamp: '2026-11-22T10:00:00Z',
  reference: 'ORD-9910',
}

describe('watermarkLabel', () => {
  it('joins buyer, #reference, store and timestamp with a middot', () => {
    expect(watermarkLabel(info)).toBe('Asha Rao · #ORD-9910 · Halo Audio · 2026-11-22T10:00:00Z')
  })

  it('drops the reference when absent', () => {
    expect(watermarkLabel({ ...info, reference: null })).toBe('Asha Rao · Halo Audio · 2026-11-22T10:00:00Z')
  })

  it('uses the override time when given', () => {
    expect(watermarkLabel(info, '2026-11-22T11:30:00Z')).toContain('2026-11-22T11:30:00Z')
    expect(watermarkLabel(info, '2026-11-22T11:30:00Z')).not.toContain('10:00:00Z')
  })
})

describe('Watermark (render)', () => {
  it('renders an aria-hidden overlay carrying the identity label', () => {
    const { container } = render(<Watermark info={info} />)
    const layer = container.querySelector('[data-vault-watermark]')
    expect(layer).not.toBeNull()
    expect(layer).toHaveAttribute('aria-hidden')
  })

  it('tiles the label and shows the stamp with the initial timestamp', () => {
    render(<Watermark info={info} />)
    // Many tiled copies + one stamp all carry the label text.
    const hits = screen.getAllByText(/Asha Rao · #ORD-9910 · Halo Audio/)
    expect(hits.length).toBeGreaterThan(1)
  })
})
