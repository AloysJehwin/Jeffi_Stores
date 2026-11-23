import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import CopySku from '@/components/ui/CopySku'

describe('CopySku (render + clipboard)', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
  })

  it('renders nothing without a sku', () => {
    const { container } = render(<CopySku sku={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders a copy button labelled with the sku', () => {
    render(<CopySku sku="ABC-123" />)
    expect(screen.getByRole('button', { name: 'Copy SKU ABC-123' })).toBeInTheDocument()
  })

  it('writes the sku to the clipboard and flips to the copied state on click', async () => {
    render(<CopySku sku="ABC-123" />)
    fireEvent.click(screen.getByRole('button'))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('ABC-123')
    await waitFor(() => expect(screen.getByRole('button')).toHaveAttribute('title', 'Copied!'))
  })

  it('stops click propagation so it does not trigger a parent row', () => {
    const rowClick = vi.fn()
    render(
      <div onClick={rowClick}>
        <CopySku sku="X1" />
      </div>
    )
    fireEvent.click(screen.getByRole('button'))
    expect(rowClick).not.toHaveBeenCalled()
  })
})
