import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn() }))
vi.mock('@/lib/shared/whatsapp', () => ({ markWhatsAppRead: vi.fn() }))
vi.mock('@/lib/support/messages', () => ({ markReceipts: vi.fn() }))
vi.mock('@/lib/support/http', () => ({ adminChat: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/support/sessions/[sessionId]/receipts/route'
import { queryOne } from '@/lib/shared/db'
import { markWhatsAppRead } from '@/lib/shared/whatsapp'
import { markReceipts } from '@/lib/support/messages'
import { adminChat } from '@/lib/support/http'

const UP_TO = '99999999-9999-4999-8999-999999999999'
const ctx = { params: Promise.resolve({ sessionId: 's1' }) }
const req = (body: unknown) =>
  new NextRequest('http://localhost/api/admin/support/sessions/s1/receipts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const deny = (status: number) => NextResponse.json({ error: 'no' }, { status })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(adminChat).mockResolvedValue({ admin: { adminId: 'a1' }, session: { id: 's1', wa_audience: 'staff' } } as any)
  vi.mocked(markReceipts).mockResolvedValue(2 as any)
  vi.mocked(markWhatsAppRead).mockResolvedValue(undefined as any)
})

describe('POST /api/admin/support/sessions/[sessionId]/receipts', () => {
  it('rejects unauthenticated and missing scope', async () => {
    vi.mocked(adminChat).mockResolvedValueOnce(deny(401))
    expect((await POST(req({ state: 'read', upTo: UP_TO }), ctx)).status).toBe(401)
    vi.mocked(adminChat).mockResolvedValueOnce(deny(403))
    expect((await POST(req({ state: 'read', upTo: UP_TO }), ctx)).status).toBe(403)
    expect(adminChat).toHaveBeenCalledWith(expect.anything(), 's1', 'customers:read', { passive: true })
    expect(markReceipts).not.toHaveBeenCalled()
  })

  it('returns 400 for a bad state or message id', async () => {
    expect((await POST(req({ state: 'seen', upTo: UP_TO }), ctx)).status).toBe(400)
    expect((await POST(req({ state: 'read', upTo: 'x' }), ctx)).status).toBe(400)
    expect(markReceipts).not.toHaveBeenCalled()
  })

  it('records delivered receipts without touching WhatsApp', async () => {
    expect(await (await POST(req({ state: 'delivered', upTo: UP_TO }), ctx)).json()).toEqual({ updated: 2 })
    expect(markReceipts).toHaveBeenCalledWith('s1', 'admin', 'delivered', UP_TO)
    expect(queryOne).not.toHaveBeenCalled()
    expect(markWhatsAppRead).not.toHaveBeenCalled()
  })

  it('marks the WhatsApp message read with the chat audience on read', async () => {
    vi.mocked(queryOne).mockResolvedValue({ provider_sid: 'wamid.1', read_at: 'now' } as any)
    expect(await (await POST(req({ state: 'read', upTo: UP_TO }), ctx)).json()).toEqual({ updated: 2 })
    expect(queryOne).toHaveBeenCalledWith(expect.stringContaining("channel = 'whatsapp'"), ['s1', UP_TO])
    expect(markWhatsAppRead).toHaveBeenCalledWith('wamid.1', 'staff')
  })

  it('skips WhatsApp when nothing was unread, and survives a WhatsApp failure', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(null as any)
    expect((await POST(req({ state: 'read', upTo: UP_TO }), ctx)).status).toBe(200)
    expect(markWhatsAppRead).not.toHaveBeenCalled()
    vi.mocked(queryOne).mockResolvedValueOnce({ provider_sid: 'wamid.2', read_at: 'now' } as any)
    vi.mocked(markWhatsAppRead).mockRejectedValueOnce(new Error('wa down'))
    expect((await POST(req({ state: 'read', upTo: UP_TO }), ctx)).status).toBe(200)
  })

  it('survives a failing read-receipt query', async () => {
    vi.mocked(queryOne).mockRejectedValue(new Error('db'))
    expect((await POST(req({ state: 'read', upTo: UP_TO }), ctx)).status).toBe(200)
  })
})
