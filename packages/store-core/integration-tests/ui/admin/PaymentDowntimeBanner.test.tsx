import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const activeDowntimes = vi.fn<(...a: any[]) => any>()
vi.mock('@/lib/payments/rzp-downtime', () => ({
  activeDowntimes: (...a: any[]) => activeDowntimes(...a),
  downtimeLabel: (d: any) => `${d.method.toUpperCase()} (${d.instrument?.bank ?? 'ALL'})`,
}))

import PaymentDowntimeBanner from '@/components/admin/PaymentDowntimeBanner'

const row = (o: Record<string, any> = {}) => ({
  id: 'd1', method: 'upi', instrument: { bank: '@ybl' }, severity: 'low', status: 'started',
  scheduled: false, begin_at: '2026-11-20T04:30:00Z', end_at: null, ...o,
})

beforeEach(() => activeDowntimes.mockReset())

describe('PaymentDowntimeBanner (async server component)', () => {
  it('renders nothing when there is no outage', async () => {
    activeDowntimes.mockResolvedValue([])
    expect(await PaymentDowntimeBanner()).toBeNull()
  })

  it('describes a started outage and reassures about other methods', async () => {
    activeDowntimes.mockResolvedValue([row({ severity: 'high' })])
    render(await PaymentDowntimeBanner())
    expect(screen.getByText('UPI (@ybl)')).toBeInTheDocument()
    expect(screen.getByText(/payments are failing at Razorpay since/)).toBeInTheDocument()
    expect(screen.getByText(/\(severe\)/)).toBeInTheDocument()
    expect(screen.getByText(/Other payment methods still work/)).toBeInTheDocument()
  })

  it('describes a scheduled window with start and end', async () => {
    activeDowntimes.mockResolvedValue([row({ status: 'scheduled', end_at: '2026-11-21T04:30:00Z' })])
    render(await PaymentDowntimeBanner())
    expect(screen.getByText(/scheduled downtime from .* to /)).toBeInTheDocument()
    expect(screen.queryByText(/\(severe\)/)).not.toBeInTheDocument()
  })

  it('lists several outages', async () => {
    activeDowntimes.mockResolvedValue([row(), row({ id: 'd2', method: 'card', instrument: { bank: 'HDFC' } })])
    render(await PaymentDowntimeBanner())
    expect(screen.getByText('CARD (HDFC)')).toBeInTheDocument()
    expect(screen.getByText('UPI (@ybl)')).toBeInTheDocument()
  })
})
