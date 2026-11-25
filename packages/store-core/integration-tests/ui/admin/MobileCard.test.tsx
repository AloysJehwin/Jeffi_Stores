import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MobileCard from '@/components/admin/MobileCard'

describe('MobileCard', () => {
  it('renders children in a plain div when there is no onClick', () => {
    render(<MobileCard className="extra">Order #1</MobileCard>)
    expect(screen.getByText('Order #1').tagName).toBe('DIV')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('Order #1').className).toMatch(/extra/)
  })

  it('renders a tappable button that fires onClick', () => {
    const onClick = vi.fn<(...a: any[]) => any>()
    render(<MobileCard onClick={onClick}>Order #2</MobileCard>)
    fireEvent.click(screen.getByRole('button', { name: 'Order #2' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('uses the accent border when accent is set', () => {
    render(<MobileCard accent>Flagged</MobileCard>)
    expect(screen.getByText('Flagged').className).toMatch(/border-yellow-400/)
  })
})
