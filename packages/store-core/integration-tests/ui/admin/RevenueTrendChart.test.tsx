import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('@/components/admin/AdminSelect', () => ({
  default: ({ value, onChange, options, disabled }: any) => (
    <select aria-label="period" value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>
      {options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}))

import RevenueTrendChart from '@/components/admin/RevenueTrendChart'

const trend = (o: Record<string, any> = {}) => ({
  months: ['2026-09', '2026-10', '2026-11'],
  series: [
    { source: 'web', label: 'Website', color: '#0a0', points: [1000, 2000, 3000] },
    { source: 'pos', label: 'Store', color: '#00a', points: [0, 500, 0] },
    { source: 'amazon', label: 'Amazon', color: '#a00', points: [0, 0, 0] },
  ],
  ...o,
}) as any
const fetchMock = vi.fn<(...a: any[]) => any>()

beforeEach(() => vi.stubGlobal('fetch', fetchMock))

describe('RevenueTrendChart', () => {
  it('draws a legend and line per active source, skipping all-zero sources', () => {
    const { container } = render(<RevenueTrendChart data={trend()} />)
    expect(screen.getByText('Revenue Trend')).toBeInTheDocument()
    expect(screen.getByText('Website')).toBeInTheDocument()
    expect(screen.getByText('Store')).toBeInTheDocument()
    expect(screen.queryByText('Amazon')).not.toBeInTheDocument()
    expect(container.querySelectorAll('polyline')).toHaveLength(2)
    expect(screen.getByText('Nov')).toBeInTheDocument()
  })

  it('shows an empty message with no revenue', () => {
    render(<RevenueTrendChart data={trend({ months: [], series: [] })} />)
    expect(screen.getByText('No revenue data yet')).toBeInTheDocument()
  })

  it('shows a per-month tooltip on hover and hides it on leave', () => {
    const { container } = render(<RevenueTrendChart data={trend()} />)
    const rects = container.querySelectorAll('rect')
    fireEvent.mouseEnter(rects[2])
    expect(screen.getByText('Nov 2026')).toBeInTheDocument()
    expect(screen.getByText('₹3,000')).toBeInTheDocument()
    fireEvent.mouseLeave(rects[2])
    expect(screen.queryByText('Nov 2026')).not.toBeInTheDocument()
  })

  it('refetches for a new period, keeping the list filters, and swaps the data', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ trend: trend({ series: [{ source: 'web', label: 'Online', color: '#0a0', points: [1, 2, 3] }] }) }) })
    render(<RevenueTrendChart data={trend()} query="status=paid" />)
    fireEvent.change(screen.getByLabelText('period'), { target: { value: '3m' } })
    expect(await screen.findByText('Online')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/orders/revenue-trend?period=3m&status=paid')
    expect(screen.queryByText('Website')).not.toBeInTheDocument()
  })

  it('keeps the previous data when the refetch fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) })
    render(<RevenueTrendChart data={trend()} />)
    fireEvent.change(screen.getByLabelText('period'), { target: { value: '6m' } })
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByLabelText('period')).not.toBeDisabled())
    expect(screen.getByText('Website')).toBeInTheDocument()
  })
})
