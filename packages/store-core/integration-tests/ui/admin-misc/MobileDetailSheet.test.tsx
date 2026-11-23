import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MobileDetailSheet from '@/components/admin/mobile/MobileDetailSheet'

// A bottom detail sheet (portal). Closed => nothing. Open => title/subtitle, body, optional footer,
// a Close button, Escape-to-close.

describe('MobileDetailSheet (render + branches + close)', () => {
  it('renders nothing when closed', () => {
    render(
      <MobileDetailSheet open={false} onClose={() => {}} title="T">
        <p>body</p>
      </MobileDetailSheet>
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders title, subtitle and children when open', () => {
    render(
      <MobileDetailSheet open onClose={() => {}} title="Order #7" subtitle="placed today">
        <p>line items</p>
      </MobileDetailSheet>
    )
    expect(screen.getByRole('heading', { name: 'Order #7' })).toBeInTheDocument()
    expect(screen.getByText('placed today')).toBeInTheDocument()
    expect(screen.getByText('line items')).toBeInTheDocument()
  })

  it('omits the footer when none is passed and renders it when given', () => {
    const { rerender } = render(
      <MobileDetailSheet open onClose={() => {}} title="T">
        <p>b</p>
      </MobileDetailSheet>
    )
    expect(screen.queryByText('save-footer')).not.toBeInTheDocument()
    rerender(
      <MobileDetailSheet open onClose={() => {}} title="T" footer={<span>save-footer</span>}>
        <p>b</p>
      </MobileDetailSheet>
    )
    expect(screen.getByText('save-footer')).toBeInTheDocument()
  })

  it('closes via the Close button and via Escape', () => {
    const onClose = vi.fn<(...a: any[]) => any>()
    render(
      <MobileDetailSheet open onClose={onClose} title="T">
        <p>b</p>
      </MobileDetailSheet>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
