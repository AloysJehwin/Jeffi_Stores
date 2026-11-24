import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const auth = vi.hoisted(() => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => auth)
const query = vi.hoisted(() => vi.fn())
const reg = vi.hoisted(() => ({ getTenant: vi.fn(), listServiceApprovals: vi.fn(), reviewServiceApproval: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => ({ ...reg, controlPlanePool: () => ({ query }) }))
const mail = vi.hoisted(() => ({ sendServicesReviewedEmail: vi.fn() }))
vi.mock('@/lib/shared/ecom-emails', () => mail)
const kyb = vi.hoisted(() => ({ kybGate: vi.fn(), tenantOwnerId: vi.fn() }))
vi.mock('@controller/lib/kyb/gate', () => kyb)

import { POST } from '@controller/app/api/(admin)/admin/ecom/customers/[id]/services/route'

const call = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/admin/ecom/customers/t-1/services', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }), {
    params: Promise.resolve({ id: 't-1' }),
  })

beforeEach(() => {
  vi.clearAllMocks()
  auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-1', email: 'op@example.com', role: 'administrator', scopes: [] })
  reg.getTenant.mockResolvedValue({ id: 't-1', display_name: 'Acme' })
  reg.reviewServiceApproval.mockResolvedValue(['messaging'])
  reg.listServiceApprovals.mockResolvedValue([{ service: 'messaging', status: 'approved' }])
  kyb.tenantOwnerId.mockResolvedValue('o-1')
  kyb.kybGate.mockResolvedValue({ ok: true })
  query.mockResolvedValue({ rows: [{ email: 'owner@example.com', name: 'Olive' }] })
  mail.sendServicesReviewedEmail.mockResolvedValue(undefined)
})

describe('POST /api/admin/ecom/customers/[id]/services', () => {
  it('401s and 403s', async () => {
    auth.authenticateAdmin.mockResolvedValue(null)
    expect((await call({ service: 'messaging', decision: 'approved' })).status).toBe(401)
    auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-2', role: 'super_admin', scopes: [] })
    expect((await call({ service: 'messaging', decision: 'approved' })).status).toBe(403)
    expect(reg.reviewServiceApproval).not.toHaveBeenCalled()
  })

  it.each([[{}], [{ service: 'store', decision: 'approved' }], [{ service: 'messaging', decision: 'rejected' }], ['not json']])('400s for a bad body %#', async body => {
    expect((await call(body)).status).toBe(400)
    expect(reg.reviewServiceApproval).not.toHaveBeenCalled()
  })

  it('404s for an unknown tenant', async () => {
    reg.getTenant.mockResolvedValue(null)
    expect((await call({ service: 'messaging', decision: 'approved' })).status).toBe(404)
  })

  it('409s an approval while KYB is incomplete, offering force', async () => {
    kyb.kybGate.mockResolvedValue({ ok: false, message: 'KYB missing', missing: ['gst'] })
    const res = await call({ service: 'messaging', decision: 'approved' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'KYB missing', missing: ['gst'], canForce: true })
    expect(reg.reviewServiceApproval).not.toHaveBeenCalled()
  })

  it('approves with force without consulting the gate and mails the owner', async () => {
    const res = await call({ service: 'messaging', decision: 'approved', force: true })
    expect(res.status).toBe(200)
    expect(kyb.kybGate).not.toHaveBeenCalled()
    expect(reg.reviewServiceApproval).toHaveBeenCalledWith('t-1', ['messaging'], 'approved', 'op@example.com', undefined)
    expect(mail.sendServicesReviewedEmail).toHaveBeenCalledWith({ email: 'owner@example.com', name: 'Olive' }, 'Acme', ['messaging'], 'approved', undefined)
    expect((await res.json()).approvals).toEqual([{ service: 'messaging', status: 'approved' }])
  })

  it('rejects with a note without the KYB gate', async () => {
    const res = await call({ service: 'documents', decision: 'rejected', note: 'incomplete' })
    expect(res.status).toBe(200)
    expect(kyb.kybGate).not.toHaveBeenCalled()
    expect(reg.reviewServiceApproval).toHaveBeenCalledWith('t-1', ['documents'], 'rejected', 'op@example.com', 'incomplete')
  })

  it('409s when nothing was pending, sending no mail', async () => {
    reg.reviewServiceApproval.mockResolvedValue([])
    expect((await call({ service: 'messaging', decision: 'approved' })).status).toBe(409)
    expect(mail.sendServicesReviewedEmail).not.toHaveBeenCalled()
  })

  it('succeeds when the owner mail fails', async () => {
    mail.sendServicesReviewedEmail.mockRejectedValue(new Error('smtp'))
    expect((await call({ service: 'messaging', decision: 'approved' })).status).toBe(200)
  })
})
