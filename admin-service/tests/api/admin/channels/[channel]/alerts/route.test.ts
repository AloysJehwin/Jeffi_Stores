import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

const m = vi.hoisted(() => ({
  requireAdminScope: vi.fn(),
  planGate: vi.fn(),
  list: vi.fn(),
  config: vi.fn(),
  emails: vi.fn(),
  save: vi.fn(),
  ruleSetFor: vi.fn(),
}))
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: m.requireAdminScope }))
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: m.planGate }))
vi.mock('@/lib/channels/alerts-engine', () => ({
  listChannelAlerts: m.list,
  getRuleConfig: m.config,
  getAlertEmails: m.emails,
  saveRuleSettings: m.save,
  mergeRuleConfig: (rs: any, raw: string) => ({ ...rs.defaults, ...JSON.parse(raw) }),
}))
vi.mock('@/lib/channels/registry', async importOriginal => ({ ...(await importOriginal<any>()), ruleSetFor: m.ruleSetFor }))

import { GET, PUT } from '@admin/app/api/(admin)/admin/channels/[channel]/alerts/route'

const RULES = {
  labels: { low_stock: 'Low stock' },
  defaults: { low_stock: { enabled: true, threshold: 5 } },
  schema: z.object({ low_stock: z.object({ enabled: z.boolean(), threshold: z.number().int().min(0).max(100) }) }),
}
const WRITER = { adminId: 'a1', email: 'owner@crm.test', role: 'staff', scopes: ['myntra:read', 'myntra:write'] }
const READER = { ...WRITER, scopes: ['myntra:read'] }
const ctx = (channel: string) => ({ params: Promise.resolve({ channel }) })
const get = (channel: string) => GET(new NextRequest(`https://acme.jeffistores.in/api/admin/channels/${channel}/alerts`), ctx(channel))
const put = (channel: string, body: unknown) =>
  PUT(new NextRequest(`https://acme.jeffistores.in/api/admin/channels/${channel}/alerts`, { method: 'PUT', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }), ctx(channel))

beforeEach(() => {
  vi.clearAllMocks()
  m.requireAdminScope.mockResolvedValue(WRITER)
  m.planGate.mockResolvedValue({ allowed: true, plan: 'pro', upgradeRequired: null })
  m.ruleSetFor.mockResolvedValue(RULES)
  m.list.mockResolvedValue([{ id: '1', rule: 'low_stock' }])
  m.config.mockResolvedValue(RULES.defaults)
  m.emails.mockResolvedValue(['ops@crm.test'])
  m.save.mockResolvedValue(undefined)
})

describe('channels alerts route', () => {
  it('answers 404 for an unknown channel', async () => {
    expect((await get('tiktok')).status).toBe(404)
    expect((await put('tiktok', {})).status).toBe(404)
    expect(m.requireAdminScope).not.toHaveBeenCalled()
  })

  it("GET needs the channel's read scope and plan", async () => {
    m.requireAdminScope.mockResolvedValue(NextResponse.json({ error: 'nope' }, { status: 403 }))
    expect((await get('myntra')).status).toBe(403)
    expect(m.requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'myntra:read')
    m.requireAdminScope.mockResolvedValue(WRITER)
    m.planGate.mockResolvedValue({ allowed: false, plan: 'growth', upgradeRequired: 'pro' })
    expect((await get('myntra')).status).toBe(403)
    expect(m.list).not.toHaveBeenCalled()
  })

  it('GET returns the alerts, rule settings, labels and recipients', async () => {
    const res = await get('myntra')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ alerts: [{ id: '1', rule: 'low_stock' }], config: RULES.defaults, labels: { low_stock: 'Low stock' }, emails: ['ops@crm.test'] })
    expect(m.list).toHaveBeenCalledWith('myntra')
    expect(m.emails).toHaveBeenCalledWith('myntra')
  })

  it('GET still answers for a channel with no alert rules', async () => {
    m.ruleSetFor.mockResolvedValue(null)
    const body = await (await get('razorpay')).json()
    expect(body).toMatchObject({ config: null, labels: {} })
  })

  it('PUT needs the write scope as well', async () => {
    m.requireAdminScope.mockResolvedValue(READER)
    const res = await put('myntra', { config: { low_stock: { enabled: false, threshold: 1 } } })
    expect(res.status).toBe(403)
    expect(m.save).not.toHaveBeenCalled()
  })

  it('PUT saves valid settings and the email switch', async () => {
    const res = await put('myntra', { config: { low_stock: { enabled: false, threshold: 9 } }, emails: false })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true, config: { low_stock: { enabled: false, threshold: 9 } } })
    expect(m.save).toHaveBeenCalledWith('myntra', { low_stock: { enabled: false, threshold: 9 } }, false)
  })

  it('PUT keeps emails on unless they are explicitly turned off', async () => {
    await put('myntra', { config: {} })
    expect(m.save).toHaveBeenCalledWith('myntra', RULES.defaults, true)
  })

  it('PUT rejects invalid settings with 400 and saves nothing', async () => {
    const res = await put('myntra', { config: { low_stock: { enabled: true, threshold: -4 } } })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Invalid alert settings')
    expect(m.save).not.toHaveBeenCalled()
  })

  it('PUT answers 404 for a channel with no alert rules', async () => {
    m.ruleSetFor.mockResolvedValue(null)
    m.requireAdminScope.mockResolvedValue({ ...WRITER, scopes: ['financial:read', 'financial:write'] })
    const res = await put('razorpay', { config: {} })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('This channel has no alert rules')
    expect(m.save).not.toHaveBeenCalled()
  })
})
