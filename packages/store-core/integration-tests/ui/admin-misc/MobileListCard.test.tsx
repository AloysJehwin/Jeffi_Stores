import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MobileListCard from '@/components/admin/mobile/MobileListCard'

// A tappable card row for mobile lists: renders children, a chevron, fires onTap on click.

describe('MobileListCard (render + tap)', () => {
  it('renders children and a dialog-opening button', () => {
    render(
      <MobileListCard onTap={() => {}} ariaLabel="Open order #42">
        <span>Order #42</span>
      </MobileListCard>
    )
    const btn = screen.getByRole('button', { name: 'Open order #42' })
    expect(btn).toHaveAttribute('aria-haspopup', 'dialog')
    expect(screen.getByText('Order #42')).toBeInTheDocument()
  })

  it('fires onTap when clicked', () => {
    const onTap = vi.fn<(...a: any[]) => any>()
    render(
      <MobileListCard onTap={onTap} ariaLabel="row">
        <span>row body</span>
      </MobileListCard>
    )
    fireEvent.click(screen.getByRole('button', { name: 'row' }))
    expect(onTap).toHaveBeenCalledTimes(1)
  })

  it('adds the accent border class when accent is set', () => {
    render(
      <MobileListCard onTap={() => {}} accent ariaLabel="r">
        <span>x</span>
      </MobileListCard>
    )
    expect(screen.getByRole('button', { name: 'r' }).className).toMatch(/border-yellow-400/)
  })

  it('uses the default border when accent is absent', () => {
    render(
      <MobileListCard onTap={() => {}} ariaLabel="r">
        <span>x</span>
      </MobileListCard>
    )
    const cls = screen.getByRole('button', { name: 'r' }).className
    expect(cls).toMatch(/border-border-default/)
    expect(cls).not.toMatch(/border-yellow-400/)
  })

  it('appends a passed className', () => {
    render(
      <MobileListCard onTap={() => {}} ariaLabel="r" className="my-extra">
        <span>x</span>
      </MobileListCard>
    )
    expect(screen.getByRole('button', { name: 'r' }).className).toMatch(/my-extra/)
  })
})
