import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn(), isPlatformAdmin: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: vi.fn() }))
vi.mock('@/lib/messaging/sender-schema', () => ({
  FlagshipSenderPutSchema: {
    safeParse: (d: any) =>
      d && d.provider && d.sender
        ? { success: true, data: { provider: d.provider, sender: d.sender, config: d.config ?? {} } }
        : { success: false, error: { issues: [{ path: ['sender'], message: 'required' }] } },
  },
}))
vi.mock('@/lib/messaging/tenant-senders', () => ({
  PLATFORM_TENANT_ID: 'platform',
  audiencesFor: vi.fn(() => ['customer', 'admin']),
  isSenderAudience: vi.fn((a: string) => ['customer', 'admin', 'ecom'].includes(a)),
  listTenantSenders: vi.fn(),
  saveTenantSender: vi.fn(),
  deleteTenantSender: vi.fn(),
  invalidateTenantSenders: vi.fn(),
}))

import { GET, PUT, DELETE } from '@admin/app/api/(admin)/admin/settings/messaging-numbers/[channel]/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope, isPlatformAdmin } from '@/lib/auth/scopes'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import * as ts from '@/lib/messaging/tenant-senders'

const admin = { adminId: 'a1', username: 'a', role: 'administrator', scopes: [] }
const ctx = (channel: string) => ({ params: Promise.resolve({ channel }) })
const req = (method: string, qs = '', body?: unknown) =>
  new NextRequest(`http://localhost/x${qs}`, { method, body: body === undefined ? undefined : JSON.stringify(body) })
const sender = { channel: 'sms', audience: 'customer', sender: '+1' }

describe('/api/admin/settings/messaging-numbers/[channel]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin)
    vi.mocked(isPlatformAdmin).mockReturnValue(true)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(resolveTenantId).mockResolvedValue('platform' as never)
    vi.mocked(ts.listTenantSenders).mockResolvedValue([sender] as never)
  })

  describe('gate', () => {
    it('returns 401 unauthenticated', async () => {
      vi.mocked(authenticateAdmin).mockResolvedValue(null)
      expect((await GET(req('GET'), ctx('sms'))).status).toBe(401)
    })

    it('returns 403 for a non-administrator or a missing settings:write scope', async () => {
      vi.mocked(isPlatformAdmin).mockReturnValue(false)
      expect((await GET(req('GET'), ctx('sms'))).status).toBe(403)
      vi.mocked(isPlatformAdmin).mockReturnValue(true)
      vi.mocked(hasScope).mockReturnValue(false)
      expect((await PUT(req('PUT', '', { provider: 'aws', sender: 'x' }), ctx('sms'))).status).toBe(403)
      expect(hasScope).toHaveBeenLastCalledWith('administrator', [], 'settings:write')
      expect(ts.saveTenantSender).not.toHaveBeenCalled()
    })

    it('returns 403 on a store tenant', async () => {
      vi.mocked(resolveTenantId).mockResolvedValue('store-1' as never)
      expect((await DELETE(req('DELETE'), ctx('sms'))).status).toBe(403)
      expect(ts.deleteTenantSender).not.toHaveBeenCalled()
    })

    it('treats an unresolvable tenant as the platform', async () => {
      vi.mocked(resolveTenantId).mockRejectedValue(new Error('none'))
      expect((await GET(req('GET'), ctx('sms'))).status).toBe(200)
    })

    it('returns 400 for an unknown channel or audience', async () => {
      expect((await GET(req('GET'), ctx('fax'))).status).toBe(400)
      expect((await GET(req('GET', '?audience=bogus'), ctx('sms'))).status).toBe(400)
      expect((await GET(req('GET', '?audience=ecom'), ctx('sms'))).status).toBe(400)
    })
  })

  it('GET returns the sender for the channel and audience', async () => {
    const body = await (await GET(req('GET'), ctx('sms'))).json()
    expect(body).toEqual({ sender })
    expect(ts.invalidateTenantSenders).toHaveBeenCalledWith('platform')
  })

  it('GET returns null when none is configured', async () => {
    vi.mocked(ts.listTenantSenders).mockResolvedValue([] as never)
    expect(await (await GET(req('GET'), ctx('whatsapp'))).json()).toEqual({ sender: null })
  })

  describe('PUT', () => {
    it('returns 400 for an invalid body', async () => {
      expect((await PUT(req('PUT', '', {}), ctx('sms'))).status).toBe(400)
    })

    it('requires the phone number id for AWS WhatsApp', async () => {
      const res = await PUT(req('PUT', '', { provider: 'aws', sender: 'x', config: {} }), ctx('whatsapp'))
      expect(res.status).toBe(400)
      expect(ts.saveTenantSender).not.toHaveBeenCalled()
    })

    it('saves the number and returns the new state', async () => {
      const res = await PUT(req('PUT', '?audience=admin', { provider: 'aws', sender: '+9', config: { whatsapp_phone_number_id: 'n1' } }), ctx('whatsapp'))
      expect(res.status).toBe(200)
      expect(ts.saveTenantSender).toHaveBeenCalledWith({
        tenantId: 'platform', channel: 'whatsapp', audience: 'admin', provider: 'aws', sender: '+9', config: { whatsapp_phone_number_id: 'n1' }, createdBy: 'a1',
      })
    })

    it('returns 400 with the message when saving fails', async () => {
      vi.mocked(ts.saveTenantSender).mockRejectedValue(new Error('bad creds'))
      const res = await PUT(req('PUT', '', { provider: 'twilio', sender: '+1' }), ctx('sms'))
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('bad creds')
    })
  })

  it('DELETE removes the number and returns the state', async () => {
    vi.mocked(ts.listTenantSenders).mockResolvedValue([] as never)
    const res = await DELETE(req('DELETE', '?audience=admin'), ctx('sms'))
    expect(await res.json()).toEqual({ sender: null })
    expect(ts.deleteTenantSender).toHaveBeenCalledWith('platform', 'sms', 'admin')
  })
})
