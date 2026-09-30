import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

import MobileListCard from '@/components/admin/mobile/MobileListCard'
import MobileDetailSheet from '@/components/admin/mobile/MobileDetailSheet'
import MobileActionSheet from '@/components/admin/mobile/MobileActionSheet'

afterEach(cleanup)

describe('MobileListCard', () => {
  it('is a tappable dialog trigger that fires onTap', () => {
    const onTap = vi.fn()
    render(
      <MobileListCard onTap={onTap} ariaLabel="Open Widget">
        <span>Widget</span>
      </MobileListCard>
    )
    const button = screen.getByRole('button', { name: 'Open Widget' })
    expect(button.getAttribute('aria-haspopup')).toBe('dialog')
    fireEvent.click(button)
    expect(onTap).toHaveBeenCalledTimes(1)
  })
})

describe('MobileDetailSheet', () => {
  it('renders title, subtitle and children only when open', () => {
    const onClose = vi.fn()
    const { rerender } = render(
      <MobileDetailSheet open={false} onClose={onClose} title="Product A" subtitle="SKU-1">
        <p>detail body</p>
      </MobileDetailSheet>
    )
    expect(screen.queryByText('detail body')).toBeNull()

    rerender(
      <MobileDetailSheet open onClose={onClose} title="Product A" subtitle="SKU-1">
        <p>detail body</p>
      </MobileDetailSheet>
    )
    expect(screen.getByText('Product A')).toBeTruthy()
    expect(screen.getByText('SKU-1')).toBeTruthy()
    expect(screen.getByText('detail body')).toBeTruthy()
  })

  it('closes on Escape and on the close button', () => {
    const onClose = vi.fn()
    render(
      <MobileDetailSheet open onClose={onClose} title="Product A">
        <p>body</p>
      </MobileDetailSheet>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})

describe('MobileActionSheet', () => {
  it('renders each action and fires its handler then closes', () => {
    const onClose = vi.fn()
    const onSelect = vi.fn()
    render(
      <MobileActionSheet
        open
        onClose={onClose}
        title="Product A"
        actions={[
          { key: 'view', label: 'View full product', onSelect },
          { key: 'del', label: 'Delete product', danger: true, onSelect: vi.fn() },
        ]}
      />
    )
    expect(screen.getByText('View full product')).toBeTruthy()
    expect(screen.getByText('Delete product')).toBeTruthy()

    fireEvent.click(screen.getByText('View full product'))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not fire a disabled action', () => {
    const onSelect = vi.fn()
    render(
      <MobileActionSheet
        open
        onClose={vi.fn()}
        actions={[{ key: 'x', label: 'Busy action', disabled: true, onSelect }]}
      />
    )
    fireEvent.click(screen.getByText('Busy action'))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('renders nothing while closed', () => {
    render(<MobileActionSheet open={false} onClose={vi.fn()} actions={[{ key: 'x', label: 'Hidden', onSelect: vi.fn() }]} />)
    expect(screen.queryByText('Hidden')).toBeNull()
  })
})
