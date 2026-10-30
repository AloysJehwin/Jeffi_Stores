import { describe, it, expect, vi, beforeEach } from 'vitest'

const cpQuery = vi.fn()
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query: cpQuery }) }))
vi.mock('@/lib/shared/admin-notify', () => ({ createAdminNotification: vi.fn(async () => {}) }))
vi.mock('@/lib/email', () => ({ sendPaymentDowntimeEmail: vi.fn(async () => {}) }))

import { recordDowntime, activeDowntimes, downtimeLabel } from '@/lib/payments/rzp-downtime'
import { createAdminNotification } from '@/lib/shared/admin-notify'
import { sendPaymentDowntimeEmail } from '@/lib/email'

beforeEach(() => {
  vi.clearAllMocks()
  cpQuery.mockResolvedValue({ rows: [], rowCount: 1 })
})

describe('rzp-downtime', () => {
  it('labels the method and its affected instruments', () => {
    expect(downtimeLabel({ method: 'upi', instrument: { vpa_handle: '@ybl' } })).toBe('UPI (@ybl)')
    expect(downtimeLabel({ method: 'card', instrument: { network: 'ALL', issuer: 'HDFC' } })).toBe('Card (HDFC)')
    expect(downtimeLabel({ method: 'paylater', instrument: null })).toBe('paylater')
  })

  it('alerts once for a serious outage, whichever account reports it first', async () => {
    await recordDowntime('payment.downtime.started', { id: 'down_1', method: 'upi', severity: 'high', begin: 1_800_000_000 }, 'platform')
    expect(createAdminNotification).toHaveBeenCalledWith(expect.objectContaining({ severity: 'critical', entityId: 'down_1' }))
    await vi.waitFor(() => expect(sendPaymentDowntimeEmail).toHaveBeenCalledWith(expect.objectContaining({ label: 'UPI' })))

    vi.clearAllMocks()
    cpQuery.mockResolvedValue({ rows: [], rowCount: 0 })
    await recordDowntime('payment.downtime.updated', { id: 'down_1', method: 'upi', severity: 'high', status: 'started' }, 'own')
    expect(createAdminNotification).not.toHaveBeenCalled()
  })

  it('records but does not alert on a resolved or minor outage', async () => {
    await recordDowntime('payment.downtime.resolved', { id: 'down_2', method: 'upi' }, 'platform')
    await recordDowntime('payment.downtime.started', { id: 'down_3', method: 'netbanking', severity: 'low' }, 'platform')
    await recordDowntime('payment.downtime.started', {}, 'platform')
    expect(cpQuery).toHaveBeenCalledTimes(2)
    expect(cpQuery.mock.calls[0][1][4]).toBe('resolved')
    expect(createAdminNotification).not.toHaveBeenCalled()
  })

  it('lists active outages, cached for a minute', async () => {
    await recordDowntime('payment.downtime.resolved', { id: 'down_4', method: 'card' }, 'platform')
    cpQuery.mockResolvedValue({ rows: [{ id: 'down_5', method: 'card' }] })
    await expect(activeDowntimes()).resolves.toEqual([{ id: 'down_5', method: 'card' }])
    await activeDowntimes()
    expect(cpQuery).toHaveBeenCalledTimes(2)
  })
})
