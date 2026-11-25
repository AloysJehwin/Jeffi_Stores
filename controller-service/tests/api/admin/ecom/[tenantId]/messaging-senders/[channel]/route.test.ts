import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const auth = vi.hoisted(() => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => auth)
const reg = vi.hoisted(() => ({ getTenant: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => reg)
const senders = vi.hoisted(() => ({
  audiencesFor: vi.fn(),
  deleteTenantSender: vi.fn(),
  invalidateTenantSenders: vi.fn(),
  isSenderAudience: vi.fn((a: string) => a === 'customer' || a === 'admin'),
  listTenantSenders: vi.fn(),
  saveTenantSender: vi.fn(),
}))
vi.mock('@/lib/messaging/tenant-senders', () => senders)
const addon = vi.hoisted(() => ({ getMessagingAddon: vi.fn(), invalidateMessagingEntitlement: vi.fn(), messagingEntitlement: vi.fn() }))
vi.mock('@/lib/billing/messaging-addon', () => addon)
vi.mock('@/lib/messaging/sender-schema', async () => {
  const { z } = await import('zod')
  return {
    SenderPutSchema: z.object({
      provider: z.enum(['aws', 'twilio']),
      sender: z.string().min(1),
      config: z.object({ whatsapp_phone_number_id: z.string().optional() }).default({}),
    }),
  }
})

import { GET, PUT, DELETE } from '@controller/app/api/(admin)/admin/ecom/[tenantId]/messaging-senders/[channel]/route'

const ctx = (channel = 'sms') => ({ params: Promise.resolve({ tenantId: 't-1', channel }) })
const url = (qs = '') => `http://localhost/api/admin/ecom/t-1/messaging-senders/sms${qs}`
const get = (channel?: string, qs?: string) => GET(new NextRequest(url(qs)), ctx(channel))
const put = (body: unknown, channel = 'sms') => PUT(new NextRequest(url(), { method: 'PUT', body: JSON.stringify(body) }), ctx(channel))
const del = () => DELETE(new NextRequest(url(), { method: 'DELETE' }), ctx())

beforeEach(() => {
  vi.clearAllMocks()
  auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-1', role: 'administrator', scopes: [] })
  reg.getTenant.mockResolvedValue({ id: 't-1' })
  senders.audiencesFor.mockReturnValue(['customer', 'admin'])
  senders.listTenantSenders.mockResolvedValue([{ channel: 'sms', audience: 'customer', sender: '+1' }])
  addon.getMessagingAddon.mockResolvedValue({ plan: 'x' })
  addon.messagingEntitlement.mockResolvedValue({ sms: { allowed: true }, whatsapp: { allowed: false } })
})

describe('/api/admin/ecom/[tenantId]/messaging-senders/[channel]', () => {
  it('401s and 403s', async () => {
    auth.authenticateAdmin.mockResolvedValue(null)
    expect((await get()).status).toBe(401)
    auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-2', role: 'super_admin', scopes: [] })
    expect((await get()).status).toBe(403)
    expect(senders.listTenantSenders).not.toHaveBeenCalled()
  })

  it('a non-platform admin gets 403 on every write, including the India DLT sender, and nothing is saved or deleted', async () => {
    auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-2', role: 'super_admin', scopes: ['settings:write'] })
    expect((await put({ provider: 'aws', sender: 'JEFFIS', config: { credentials: 'platform' } })).status).toBe(403)
    expect((await del()).status).toBe(403)
    expect(senders.saveTenantSender).not.toHaveBeenCalled()
    expect(senders.deleteTenantSender).not.toHaveBeenCalled()
  })

  it('GET returns masked meta only, never credentials', async () => {
    senders.listTenantSenders.mockResolvedValue([{ channel: 'sms', audience: 'customer', provider: 'aws', sender: 'JEFFIS', meta: { credentials: 'platform', region: 'ap-south-1' } }])
    const text = JSON.stringify(await (await get()).json())
    expect(text).toContain('ap-south-1')
    expect(text).not.toMatch(/secret_access_key|config_enc|auth_token"/)
  })

  it('400s for an unknown channel or audience, 404s for an unknown tenant', async () => {
    expect((await get('fax')).status).toBe(400)
    expect((await get('sms', '?audience=bogus')).status).toBe(400)
    senders.audiencesFor.mockReturnValue(['customer'])
    expect((await get('sms', '?audience=admin')).status).toBe(400)
    reg.getTenant.mockResolvedValue(null)
    expect((await get()).status).toBe(404)
  })

  it('GET returns the sender, add-on and entitlement for the channel', async () => {
    const res = await get()
    expect(await res.json()).toEqual({
      sender: { channel: 'sms', audience: 'customer', sender: '+1' },
      addon: { plan: 'x' },
      entitlement: { allowed: true },
    })
    expect(senders.invalidateTenantSenders).toHaveBeenCalledWith('t-1')
    expect(addon.invalidateMessagingEntitlement).toHaveBeenCalledWith('t-1')
  })

  it('PUT 400s for a bad body', async () => {
    expect((await put({ provider: 'nope' })).status).toBe(400)
    expect(senders.saveTenantSender).not.toHaveBeenCalled()
  })

  it('PUT needs the phone number id for AWS WhatsApp', async () => {
    const res = await put({ provider: 'aws', sender: '+1', config: {} }, 'whatsapp')
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('phone number id')
  })

  it('PUT saves the sender and returns the new state', async () => {
    const res = await put({ provider: 'twilio', sender: '+1', config: {} })
    expect(res.status).toBe(200)
    expect(senders.saveTenantSender).toHaveBeenCalledWith({
      tenantId: 't-1',
      channel: 'sms',
      audience: 'customer',
      provider: 'twilio',
      sender: '+1',
      config: {},
      createdBy: 'a-1',
    })
  })

  it('PUT relays a save failure as 400', async () => {
    senders.saveTenantSender.mockRejectedValue(new Error('number taken'))
    const res = await put({ provider: 'twilio', sender: '+1', config: {} })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'number taken' })
  })

  it('DELETE removes the sender', async () => {
    const res = await del()
    expect(res.status).toBe(200)
    expect(senders.deleteTenantSender).toHaveBeenCalledWith('t-1', 'sms', 'customer')
  })
})
