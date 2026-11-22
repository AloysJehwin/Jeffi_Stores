import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import WalletBadge from '@/components/admin/WalletBadge'

// Top-nav shipping-wallet badge. Server-provided initial balance; low (< min) switches to the amber style.

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn<(...a: any[]) => any>(() => Promise.resolve({ ok: false } as Response)))
})

describe('WalletBadge (render + low-balance branch)', () => {
  it('renders the initial balance formatted as INR', () => {
    render(<WalletBadge initialBalance={1500} initialMinBalance={500} />)
    expect(screen.getByText('₹1,500')).toBeInTheDocument()
  })

  it('uses the normal style and title when balance is at or above the minimum', () => {
    render(<WalletBadge initialBalance={1500} initialMinBalance={500} />)
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('title', 'Shipping wallet balance')
    expect(link.className).toMatch(/bg-white\/15/)
    expect(link.className).not.toMatch(/bg-amber-400/)
  })

  it('switches to the amber low-balance style and title when below the minimum', () => {
    render(<WalletBadge initialBalance={100} initialMinBalance={500} />)
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('title', expect.stringContaining('below its minimum'))
    expect(link.className).toMatch(/bg-amber-400/)
  })

  it('links to the wallet page', () => {
    render(<WalletBadge initialBalance={100} initialMinBalance={500} />)
    expect(screen.getByRole('link')).toHaveAttribute('href', '/admin/wallet')
  })
})
