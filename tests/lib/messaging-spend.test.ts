import { vi, describe, it, expect, beforeEach } from 'vitest'

const q = vi.hoisted(() => vi.fn())
const local = vi.hoisted(() => vi.fn())
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query: q }) }))
vi.mock('@/lib/shared/db', () => ({ query: local }))

import { FLAGSHIP_TENANT_ID, getMessagingSpend } from '@/lib/payments/wallet'

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

  it('totals the flagship from what its messages cost, not its (never debited) wallet', async () => {
    local.mockResolvedValue({ rows: [{ channel: 'whatsapp', month: '2026-10', spent: '0.88' }] })
    q.mockResolvedValue({ rows: [{ channel: 'whatsapp', month: '2026-10', spent: '1.4' }, { channel: 'email', month: '2026-10', spent: '0.07' }] })
    const r = await getMessagingSpend(FLAGSHIP_TENANT_ID)
    expect(r.byChannel).toEqual({ whatsapp: 2.28, email: 0.07 })
    expect(q.mock.calls[0][0]).toContain('FROM messages')
  })
})
