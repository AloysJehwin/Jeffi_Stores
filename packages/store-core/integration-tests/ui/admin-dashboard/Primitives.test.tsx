import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SectionHeader, SectionCard, Chip, statusBadgeClass, statusLabel } from '@/components/admin/dashboard/Primitives'

describe('dashboard primitives', () => {
  it('SectionHeader links to the action when given one', () => {
    const { rerender } = render(<SectionHeader title="Orders" actionLabel="View all" href="/admin/orders" />)
    expect(screen.getByRole('heading', { name: 'Orders' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /View all/ })).toHaveAttribute('href', '/admin/orders')
    rerender(<SectionHeader title="Orders" />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('SectionCard is a link with href, otherwise a plain box', () => {
    const { rerender } = render(<SectionCard href="/x">Body</SectionCard>)
    expect(screen.getByRole('link')).toHaveAttribute('href', '/x')
    rerender(<SectionCard span>Body</SectionCard>)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('Body').className).toContain('lg:col-span-2')
  })

  it('Chip renders its content', () => {
    render(<Chip tone="good">Paid</Chip>)
    expect(screen.getByText('Paid')).toBeInTheDocument()
  })

  it('maps statuses to classes and labels', () => {
    expect(statusBadgeClass('delivered')).toContain('green')
    expect(statusBadgeClass('shipped')).toContain('blue')
    expect(statusBadgeClass('cancelled')).toContain('red')
    expect(statusBadgeClass('pending')).toContain('amber')
    expect(statusLabel('granted')).toBe('Access granted')
    expect(statusLabel('out_for_delivery')).toBe('Out for Delivery')
    expect(statusLabel('cancel_requested')).toBe('Cancel Req.')
    expect(statusLabel('on_hold')).toBe('on hold')
  })
})
