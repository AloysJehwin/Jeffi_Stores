import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PageInsights, insightsLoader } from '@/components/admin/insights/PageInsights'
import { InsightsButton } from '@/components/admin/insights/InsightsButton'
import { mondayGrid, summarize, type InsightsSeries } from '@/lib/insights/series'
import { mockReducedMotion } from '../../admin-dashboard/fixtures'

const grid = mondayGrid('2026-01-14', 2)
const days = grid.dates.map((date, i) => ({ date, values: [i % 4] }))
const series: InsightsSeries = { weeks: 2, filter: null, from: grid.from, to: grid.to, today: '2026-01-14', series: [{ key: 'placed', label: 'Placed' }], days, totals: summarize(days, '2026-01-14') }

const fetchMock = vi.fn()

describe('InsightsButton', () => {
  it('is a labelled dialog trigger, or a square icon button with a tooltip', () => {
    const onClick = vi.fn()
    const { rerender } = render(<InsightsButton onClick={onClick} expanded={false} />)
    const b = screen.getByRole('button', { name: 'Insights' })
    expect(b).toHaveAttribute('aria-haspopup', 'dialog')
    expect(b).toHaveAttribute('aria-expanded', 'false')
    expect(b).toHaveClass('control-md')
    fireEvent.click(b)
    expect(onClick).toHaveBeenCalledTimes(1)
    rerender(<InsightsButton onClick={onClick} iconOnly label="Order insights" />)
    const icon = screen.getByRole('button', { name: 'Order insights' })
    expect(icon).toHaveClass('control-icon')
    expect(icon).toHaveAttribute('title', 'Order insights')
    expect(icon).not.toHaveTextContent('Order insights')
  })
})

describe('PageInsights', () => {
  beforeEach(() => {
    mockReducedMotion(true)
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('loads through the url on first open only, and hands focus back to the button on close', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ series }) })
    const url = vi.fn((q: { weeks: number; filter: string | null }) => `/api/admin/orders/insights?weeks=${q.weeks}`)
    render(<PageInsights config={{ title: 'Orders placed', copy: { subject: 'Orders placed', unit: 'placed', noun: 'orders' }, load: insightsLoader(url) }} subtitle="Halo Audio" />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
    const button = screen.getByRole('button', { name: 'Insights' })
    button.focus()
    fireEvent.click(button)
    expect(screen.getByRole('dialog', { name: 'Orders placed' })).toBeInTheDocument()
    expect(button).toHaveAttribute('aria-expanded', 'true')
    await waitFor(() => expect(screen.getByText('2-week total')).toBeInTheDocument())
    expect(url).toHaveBeenCalledWith({ weeks: 26, filter: null })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/orders/insights?weeks=26')
    expect(screen.getByText('Halo Audio · 5 Jan – 18 Jan')).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(button).toHaveFocus()
    fireEvent.click(button)
    expect(screen.getByText('2-week total')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('insightsLoader resolves null on an error status, a missing series or a network failure', async () => {
    const load = insightsLoader(() => '/x')
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'nope' }) })
    expect(await load({ weeks: 13, filter: null })).toBeNull()
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    expect(await load({ weeks: 13, filter: null })).toBeNull()
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    expect(await load({ weeks: 13, filter: null })).toBeNull()
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ series }) })
    expect(await load({ weeks: 13, filter: null })).toEqual(series)
  })

  it('insightsLoader adds weeks and filter to a base url', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ series }) })
    await insightsLoader('/api/admin/returns/insights')({ weeks: 52, filter: 'a b' })
    await insightsLoader('/api/admin/returns/insights?type=refund')({ weeks: 13, filter: null })
    expect(fetchMock.mock.calls.map(c => c[0])).toEqual(['/api/admin/returns/insights?weeks=52&filter=a%20b', '/api/admin/returns/insights?type=refund&weeks=13'])
  })
})
