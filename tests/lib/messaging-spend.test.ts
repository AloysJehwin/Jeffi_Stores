import { vi, describe, it, expect, beforeEach } from 'vitest'

const q = vi.hoisted(() => vi.fn())
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query: q }) }))

import { getMessagingSpend } from '@/lib/payments/wallet'

beforeEach(() => vi.clearAllMocks())

describe('getMessagingSpend', () => {
  it('aggregates control-plane debit rows into total + byChannel', async () => {
    const thisMonth = new Date().toISOString().slice(0, 7)
    q.mockResolvedValue({
      rows: [
        { channel: 'sms', month: thisMonth, spent: '7' },
        { channel: 'whatsapp', month: '2026-01', spent: '3' },
      ],
    })
    const r = await getMessagingSpend('t1')
    expect(r.total).toBe(10)
    expect(r.byChannel).toEqual({ sms: 7, whatsapp: 3 })
    expect(r.thisMonth).toBe(7)
  })

  it('returns zeros when the control-plane read fails', async () => {
    q.mockRejectedValue(new Error('cp down'))
    const r = await getMessagingSpend('t1')
    expect(r).toEqual({ rows: [], total: 0, thisMonth: 0, byChannel: {} })
  })
})
