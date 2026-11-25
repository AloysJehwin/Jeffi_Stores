import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))

import {
  ChartCard, TrendLines, MixDonutCard, KeyedTrendCard, RankedBarsCard, TrendChart, DonutSplit, RankedBars, HourBars,
  FunnelBar, LinkedLegend, GRAN_HINT, num, FUNNEL_STAGES,
} from '@/components/admin/kit/charts'

describe('ChartCard', () => {
  it('renders title, hint, action and body', () => {
    render(<ChartCard title="Sales" hint="by day" action={<button>Export</button>}><p>chart</p></ChartCard>)
    expect(screen.getByRole('heading', { name: 'Sales' })).toBeInTheDocument()
    expect(screen.getByText('by day')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument()
    expect(screen.getByText('chart')).toBeInTheDocument()
  })
})

describe('TrendLines', () => {
  const months = ['2026-01-01', '2026-02-01', '2026-03-01']
  const lines = [
    { key: 'in', label: 'Inflow', color: 'rgb(0 255 0)', points: [100, 250, 400] },
    { key: 'out', label: 'Outflow', color: 'rgb(255 0 0)', points: [50, 20, 90] },
    { key: 'zero', label: 'Nothing', color: 'rgb(0 0 255)', points: [0, 0, 0] },
  ]

  it('says there is no data when empty or all-zero', () => {
    const { rerender } = render(<TrendLines months={[]} lines={lines} ariaLabel="x" granularity="month" />)
    expect(screen.getByText('No data in this range.')).toBeInTheDocument()
    rerender(<TrendLines months={months} lines={[lines[2]]} ariaLabel="x" granularity="month" />)
    expect(screen.getByText('No data in this range.')).toBeInTheDocument()
  })

  it('draws a legend of the non-zero lines only and an accessible chart', () => {
    render(<TrendLines months={months} lines={lines} ariaLabel="Cash flow" granularity="month" />)
    expect(screen.getByRole('img', { name: 'Cash flow' })).toBeInTheDocument()
    expect(screen.getByText('Inflow')).toBeInTheDocument()
    expect(screen.getByText('Outflow')).toBeInTheDocument()
    expect(screen.queryByText('Nothing')).toBeNull()
    expect(screen.getByText('Jan 26')).toBeInTheDocument()
  })

  it('shows a tooltip with the bucket and values while hovering a column', () => {
    const { container } = render(<TrendLines months={months} lines={lines} ariaLabel="Cash flow" granularity="week" />)
    const hit = container.querySelectorAll('rect[fill="transparent"]')
    expect(hit).toHaveLength(3)
    fireEvent.mouseEnter(hit[1])
    expect(screen.getByText('Week of 1 Feb 2026')).toBeInTheDocument()
    expect(screen.getByText('Rs 250')).toBeInTheDocument()
    fireEvent.mouseLeave(hit[1])
    expect(screen.queryByText('Week of 1 Feb 2026')).toBeNull()
  })
})

describe('cards', () => {
  it('MixDonutCard shows the donut with the centre total, or an empty message', () => {
    const { rerender } = render(<MixDonutCard title="Payment mode" total="Rs 10" totalLabel="collected" segments={[{ label: 'UPI', value: 3, color: 'red' }, { label: 'COD', value: 1, color: 'blue' }]} />)
    expect(screen.getByText('Rs 10')).toBeInTheDocument()
    expect(screen.getByText('collected')).toBeInTheDocument()
    expect(screen.getByText('75%')).toBeInTheDocument()
    rerender(<MixDonutCard title="Payment mode" total="" totalLabel="" segments={[]} />)
    expect(screen.getByText('No data in this range.')).toBeInTheDocument()
  })

  it('KeyedTrendCard labels lines from the labels map and uses the granularity hint', () => {
    const data = [{ label: '2026-01-01', a: 5, b: 0 }, { label: '2026-01-02', a: 9, b: 0 }]
    render(<KeyedTrendCard title="AI cost" data={data} keys={['a', 'b']} labels={{ a: 'Gemini' }} granularity="day" />)
    expect(screen.getByText(GRAN_HINT.day)).toBeInTheDocument()
    expect(screen.getByText('Gemini')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'AI cost over the period.' })).toBeInTheDocument()
  })

  it('RankedBarsCard shows ranked rows or the empty message', () => {
    const { rerender } = render(<RankedBarsCard title="Top products" items={[{ name: 'Shirt', value: 10 }]} />)
    expect(screen.getByText('Shirt')).toBeInTheDocument()
    rerender(<RankedBarsCard title="Top products" items={[]} />)
    expect(screen.getByText('No data in this range.')).toBeInTheDocument()
  })

  it('num coerces non-numeric values to 0', () => {
    expect(num({ label: 'x', v: '12' } as any, 'v')).toBe(12)
    expect(num({ label: 'x', v: 'abc' } as any, 'v')).toBe(0)
  })
})

describe('TrendChart', () => {
  const points = [
    { label: '2026-01-01', revenue: 1000, orders: 4, paidOrders: 3, customers: 2, units: 6, aov: 250 },
    { label: '2026-01-02', revenue: 2500, orders: 9, paidOrders: 8, customers: 5, units: 12, aov: 280 },
    { label: '2026-01-03', revenue: 1800, orders: 6, paidOrders: 5, customers: 4, units: 9, aov: 300 },
  ]

  it('shows an empty state without points', () => {
    render(<TrendChart points={[]} />)
    expect(screen.getByText('No data in this range')).toBeInTheDocument()
  })

  it('starts with the first two series on and toggles series with the chips', () => {
    render(<TrendChart points={points} />)
    expect(screen.getByRole('button', { name: 'Revenue' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Orders' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'AOV' })).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'AOV' }))
    expect(screen.getByRole('button', { name: 'AOV' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Revenue' }))
    expect(screen.getByRole('button', { name: 'Revenue' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('reads each point with the arrow keys, formatting money and counts, and Escape clears it', () => {
    render(<TrendChart points={points} ariaLabel="Orders over time" />)
    const chart = screen.getByRole('img', { name: /Orders over time/ })
    fireEvent.keyDown(chart, { key: 'ArrowRight' })
    expect(screen.getByText('Rs 1,000')).toBeInTheDocument()
    fireEvent.keyDown(chart, { key: 'ArrowRight' })
    expect(screen.getByText('Rs 2,500')).toBeInTheDocument()
    expect(screen.getByText('9')).toBeInTheDocument()
    fireEvent.keyDown(chart, { key: 'ArrowLeft' })
    expect(screen.getByText('Rs 1,000')).toBeInTheDocument()
    fireEvent.keyDown(chart, { key: 'Escape' })
    expect(screen.queryByText('Rs 1,000')).toBeNull()
  })

  it('tells you to turn a series on when all are off', () => {
    render(<TrendChart points={points} />)
    fireEvent.click(screen.getByRole('button', { name: 'Revenue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Orders' }))
    fireEvent.keyDown(screen.getByRole('img', { name: /Revenue and orders/ }), { key: 'ArrowRight' })
    expect(screen.getByText('Turn on a series above')).toBeInTheDocument()
  })

  it('plots custom series definitions', () => {
    const series = [{ key: 'visits', label: 'Visits', color: 'rgb(1 2 3)', kind: 'line' as const, axis: 'count' as const, on: true }]
    render(<TrendChart points={[{ label: '2026-02-01', visits: 7 }, { label: '2026-02-02', visits: 9 }]} series={series} bucket="day" />)
    expect(screen.getByRole('button', { name: 'Visits' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('DonutSplit', () => {
  it('shows the centre text and a percentage per segment, zero when the total is 0', () => {
    const { rerender } = render(<DonutSplit segments={[{ label: 'B2B', value: 1, color: 'red' }, { label: 'B2C', value: 3, color: 'blue' }]} centerValue="4" centerLabel="orders" />)
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText('orders')).toBeInTheDocument()
    expect(screen.getByText('25%')).toBeInTheDocument()
    expect(screen.getByText('75%')).toBeInTheDocument()
    rerender(<DonutSplit segments={[{ label: 'B2B', value: 0, color: 'red' }]} />)
    expect(screen.getByText('0%')).toBeInTheDocument()
  })
})

describe('RankedBars', () => {
  it('ranks items with a unit, or a sub label when given', () => {
    render(<RankedBars items={[{ name: 'Shirt', value: 1200 }, { name: 'Shoes', value: 300, sub: 'Rs 5,000' }]} unit="pcs" />)
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('1,200 pcs')).toBeInTheDocument()
    expect(screen.getByText('Rs 5,000')).toBeInTheDocument()
  })

  it('shows an empty message', () => {
    render(<RankedBars items={[]} />)
    expect(screen.getByText('No data in this range.')).toBeInTheDocument()
  })
})

describe('HourBars', () => {
  it('names the busiest hour', () => {
    const counts = Array.from({ length: 24 }, (_, h) => (h === 14 ? 9 : 1))
    render(<HourBars counts={counts} />)
    expect(screen.getByText(/Busiest hour 14:00 to 15:00 with 9 orders \(IST\)/)).toBeInTheDocument()
    expect(screen.getByTitle(/14:00\s+9 orders/)).toBeInTheDocument()
  })

  it('says there is nothing when all hours are empty', () => {
    render(<HourBars counts={new Array(24).fill(0)} unit="visits" />)
    expect(screen.getByText('No visits in this range.')).toBeInTheDocument()
  })
})

describe('FunnelBar / LinkedLegend', () => {
  it('links every stage and shows its count', () => {
    render(<FunnelBar counts={{ pending: 3, delivered: 7 }} hrefFor={k => `/admin/orders?status=${k}`} />)
    for (const st of FUNNEL_STAGES) expect(screen.getAllByRole('link', { name: new RegExp(st.label) }).length).toBeGreaterThan(0)
    const delivered = screen.getAllByRole('link', { name: /Delivered/ })
    expect(delivered[delivered.length - 1]).toHaveAttribute('href', '/admin/orders?status=delivered')
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.getAllByText('0').length).toBe(4)
    expect(screen.getByTitle('Pending: 3 (30%)')).toBeInTheDocument()
  })

  it('LinkedLegend rows link to their href', () => {
    render(<LinkedLegend items={[{ label: 'UPI', value: '60%', color: 'red', href: '/admin/orders?mode=upi' }]} />)
    expect(screen.getByRole('link', { name: /UPI/ })).toHaveAttribute('href', '/admin/orders?mode=upi')
    expect(screen.getByText('60%')).toBeInTheDocument()
  })
})
