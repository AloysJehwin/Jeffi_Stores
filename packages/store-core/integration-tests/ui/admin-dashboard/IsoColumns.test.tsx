import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { IsoColumns } from '@/components/admin/dashboard/IsoColumns'
import { makeIsoDays, mockReducedMotion } from './fixtures'

const days = makeIsoDays(4) // 28 days; index 10 is the busiest (30 shipped)

const prism = (c: HTMLElement, i: number) => c.querySelector(`[data-prism="${i}"]`)!
const topPoints = (c: HTMLElement, i: number) => prism(c, i).querySelector('polygon:last-child')!.getAttribute('points')

describe('IsoColumns', () => {
  beforeEach(() => mockReducedMotion(true))

  it('renders one prism per day in 3D and no dots', () => {
    const { container } = render(<IsoColumns days={days} mode="3d" />)
    expect(container.querySelectorAll('[data-prism]')).toHaveLength(28)
    expect(container.querySelectorAll('[data-dot]')).toHaveLength(0)
    // non-zero days get side faces + top, zero days are a single flat tile
    expect(prism(container, 10).querySelectorAll('polygon')).toHaveLength(3)
    expect(prism(container, 0).querySelectorAll('polygon')).toHaveLength(1)
  })

  it('renders the same days as focusable dots in grid mode and no prisms', () => {
    const { container } = render(<IsoColumns days={days} mode="grid" />)
    expect(container.querySelectorAll('[data-prism]')).toHaveLength(0)
    expect(container.querySelectorAll('[data-dot]')).toHaveLength(28)
    expect(screen.getAllByRole('button')).toHaveLength(28)
    expect(screen.getByRole('group')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('switches between 3D and grid when the mode prop changes', () => {
    const { container, rerender } = render(<IsoColumns days={days} mode="3d" />)
    rerender(<IsoColumns days={days} mode="grid" />)
    expect(container.querySelectorAll('[data-prism]')).toHaveLength(0)
    expect(container.querySelectorAll('[data-dot]')).toHaveLength(28)
    rerender(<IsoColumns days={days} mode="3d" />)
    expect(container.querySelectorAll('[data-prism]')).toHaveLength(28)
    expect(container.querySelectorAll('[data-dot]')).toHaveLength(0)
  })

  it('has an img role with a summary label, plus a hidden data table of the days', () => {
    render(<IsoColumns days={days} mode="3d" />)
    const chart = screen.getByRole('img', { name: /Orders shipped per day over 4 weeks/ })
    expect(chart.getAttribute('aria-label')).toMatch(/busiest Thu, 15 Jan with 30/)
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(29)
  })

  it('shows the dark tooltip with date, count, average, Busiest badge, top categories and customers on hover', () => {
    const { container } = render(<IsoColumns days={days} mode="3d" />)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    fireEvent.pointerEnter(prism(container, 10))
    const tip = screen.getByRole('tooltip')
    expect(within(tip).getByText('Thu, 15 Jan')).toBeInTheDocument()
    expect(within(tip).getByText('Busiest')).toBeInTheDocument()
    expect(within(tip).getByText('30')).toBeInTheDocument()
    expect(within(tip).getByText(/× daily avg/)).toBeInTheDocument()
    expect(within(tip).getByText('Shirts')).toBeInTheDocument()
    expect(within(tip).getByText('Shoes')).toBeInTheDocument()
    expect(within(tip).getByText('Others')).toBeInTheDocument()
    expect(within(tip).getByText('29 customers')).toBeInTheDocument()
    fireEvent.pointerLeave(prism(container, 10))
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('does not badge a normal day and omits Others when categories add up', () => {
    const { container } = render(<IsoColumns days={days} mode="3d" />)
    fireEvent.pointerEnter(prism(container, 2)) // 4 shipped: Shirts 2, Shoes 1 -> Others 1
    const tip = screen.getByRole('tooltip')
    expect(within(tip).queryByText('Busiest')).not.toBeInTheDocument()
    expect(within(tip).getByText('Others')).toBeInTheDocument()
  })

  it('lightens the hovered top face', () => {
    const { container } = render(<IsoColumns days={days} mode="3d" />)
    const fill = () => prism(container, 10).querySelector('polygon:last-child')!.getAttribute('fill')
    expect(fill()).toContain('--c-accent-300')
    fireEvent.pointerEnter(prism(container, 10))
    expect(fill()).toContain('--c-accent-200')
  })

  it('orbits with the arrow keys (clamped to ±35° around 45°) and resets on double-click', () => {
    const { container } = render(<IsoColumns days={days} mode="3d" />)
    const chart = screen.getByRole('img')
    const before = topPoints(container, 10)
    expect(chart).toHaveAttribute('data-yaw', '45')
    fireEvent.keyDown(chart, { key: 'ArrowRight' })
    expect(chart).toHaveAttribute('data-yaw', '50')
    expect(topPoints(container, 10)).not.toBe(before)
    for (let i = 0; i < 30; i++) fireEvent.keyDown(chart, { key: 'ArrowRight' })
    expect(chart).toHaveAttribute('data-yaw', '80')
    for (let i = 0; i < 40; i++) fireEvent.keyDown(chart, { key: 'ArrowLeft' })
    expect(chart).toHaveAttribute('data-yaw', '10')
    fireEvent.doubleClick(chart)
    expect(chart).toHaveAttribute('data-yaw', '45')
    expect(topPoints(container, 10)).toBe(before)
  })

  it('orbits by dragging horizontally', () => {
    render(<IsoColumns days={days} mode="3d" />)
    const chart = screen.getByRole('img')
    fireEvent.pointerDown(chart, { clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(chart, { clientX: 140, pointerId: 1 })
    expect(Number(chart.getAttribute('data-yaw'))).toBeCloseTo(59, 0)
    fireEvent.pointerUp(chart, { pointerId: 1 })
    fireEvent.pointerMove(chart, { clientX: 400, pointerId: 1 })
    expect(Number(chart.getAttribute('data-yaw'))).toBeCloseTo(59, 0)
  })

  it('paints back to front for the current yaw', () => {
    const { container } = render(<IsoColumns days={days} mode="3d" />)
    const order = () => Array.from(container.querySelectorAll('[data-prism]')).map(n => n.getAttribute('data-prism'))
    const at45 = order()
    // at the default yaw the first week's first day is farthest from the viewer
    expect(at45[0]).toBe('0')
    fireEvent.keyDown(screen.getByRole('img'), { key: 'ArrowRight' })
    for (let i = 0; i < 30; i++) fireEvent.keyDown(screen.getByRole('img'), { key: 'ArrowRight' })
    expect(order()).not.toEqual(at45)
  })

  it('grid cells show the tooltip on focus and move focus with the arrow keys', () => {
    const { container } = render(<IsoColumns days={days} mode="grid" />)
    const cells = screen.getAllByRole('button')
    fireEvent.focus(cells[10])
    expect(within(screen.getByRole('tooltip')).getByText('Busiest')).toBeInTheDocument()
    fireEvent.keyDown(cells[10], { key: 'ArrowDown' })
    expect(container.querySelector('[data-cell="11"]')).toHaveFocus()
    fireEvent.keyDown(cells[10], { key: 'ArrowRight' })
    expect(container.querySelector('[data-cell="17"]')).toHaveFocus()
    fireEvent.blur(cells[17])
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('renders an empty state without days', () => {
    render(<IsoColumns days={[]} mode="3d" />)
    expect(screen.getByText('No shipments in this range.')).toBeInTheDocument()
  })

  it('takes its subject, unit and empty text from props for other pages', () => {
    const plain = days.map(d => ({ date: d.date, value: d.value }))
    const { container, unmount } = render(<IsoColumns days={plain} mode="grid" subject="Return requests" unit="requested" />)
    expect(screen.getByRole('group', { name: /^Return requests per day over 4 weeks/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Thu, 15 Jan: 30 requested' })).toBeInTheDocument()
    fireEvent.focus(container.querySelector('[data-cell="10"]')!)
    const tip = screen.getByRole('tooltip')
    expect(within(tip).getByText(/^requested · /)).toBeInTheDocument()
    expect(within(tip).queryByText('Others')).not.toBeInTheDocument()
    expect(within(tip).queryByText(/customer/)).not.toBeInTheDocument()
    unmount()
    render(<IsoColumns days={[]} mode="3d" emptyText="No returns yet." />)
    expect(screen.getByText('No returns yet.')).toBeInTheDocument()
  })

  it('rises from flat when motion is allowed, and starts fully grown when reduced', async () => {
    mockReducedMotion(false)
    const { container, unmount } = render(<IsoColumns days={days} mode="3d" />)
    expect(prism(container, 10).querySelectorAll('polygon')).toHaveLength(1) // not risen yet: top face only
    await waitFor(() => expect(prism(container, 10).querySelectorAll('polygon')).toHaveLength(3), { timeout: 3000 })
    unmount()
    mockReducedMotion(true)
    const again = render(<IsoColumns days={days} mode="3d" />)
    expect(prism(again.container, 10).querySelectorAll('polygon')).toHaveLength(3)
  })
})
