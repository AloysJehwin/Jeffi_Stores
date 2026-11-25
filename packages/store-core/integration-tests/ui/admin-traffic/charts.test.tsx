import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BarSeries, Donut, HBars, Heatmap, PALETTE, chartColor } from '@/components/admin/traffic/charts'

describe('traffic charts', () => {
  it('chartColor wraps around the palette as theme tokens', () => {
    expect(PALETTE).toHaveLength(10)
    expect(chartColor(1)).toContain('--chart-1')
    expect(chartColor(11)).toBe(chartColor(1))
  })

  it('BarSeries shows the legend and a tooltip with series values on hover', () => {
    const rows = [{ d: 'Mon', visits: 1200, orders: 30 }, { d: 'Tue', visits: 800, orders: 12 }]
    const { container } = render(<BarSeries rows={rows} series={[{ key: 'visits', label: 'Visits', color: '#00f' }, { key: 'orders', label: 'Orders', color: '#0f0' }]} label={r => r.d} />)
    expect(screen.getAllByText('Visits').length).toBeGreaterThan(0)
    fireEvent.mouseEnter(container.querySelector('.flex-1.relative')!)
    expect(screen.getByText('Visits: 1,200')).toBeInTheDocument()
    expect(screen.getByText('Orders: 30')).toBeInTheDocument()
  })

  it('BarSeries shows the empty message when nothing happened', () => {
    render(<BarSeries rows={[{ d: 'Mon', v: 0 }]} series={[{ key: 'v', label: 'V', color: '#000' }]} label={r => r.d} />)
    expect(screen.getByText('No activity in this period')).toBeInTheDocument()
  })

  it('Donut lists segments with percentages, and an empty state', () => {
    const { rerender } = render(<Donut segments={[{ label: 'Mobile', value: 75, color: '#f00', sub: 'avg 2m' }, { label: 'Desktop', value: 25, color: '#0f0' }]} />)
    expect(screen.getByText('Mobile')).toBeInTheDocument()
    expect(screen.getByText(/75 \(75%\) · avg 2m/)).toBeInTheDocument()
    expect(screen.getByText(/25 \(25%\)/)).toBeInTheDocument()
    rerender(<Donut segments={[{ label: 'x', value: 0, color: '#000' }]} />)
    expect(screen.getByText('No sessions in this period')).toBeInTheDocument()
  })

  it('HBars shows labels, values and a custom right column; empty state otherwise', () => {
    const { rerender } = render(<HBars rows={[{ key: 'a', label: '/home', value: 1500 }, { key: 'b', label: '/cart', value: 300, right: '20%' }]} />)
    expect(screen.getByText('/home')).toBeInTheDocument()
    expect(screen.getByText('1,500')).toBeInTheDocument()
    expect(screen.getByText('20%')).toBeInTheDocument()
    rerender(<HBars rows={[]} empty="Nothing yet" />)
    expect(screen.getByText('Nothing yet')).toBeInTheDocument()
  })

  it('Heatmap renders the weekday grid with hover titles, and an empty state', () => {
    const { container, rerender } = render(<Heatmap cells={[{ dow: 1, hour: 9, views: 42 }]} />)
    expect(screen.getByText('Mon')).toBeInTheDocument()
    expect(screen.getByText('21:00')).toBeInTheDocument()
    expect(container.querySelector('[title="Mon 9:00 · 42 views"]')).toBeInTheDocument()
    rerender(<Heatmap cells={[]} />)
    expect(screen.getByText('No page views in this period')).toBeInTheDocument()
  })
})
