import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  owner: vi.fn(),
  tenants: vi.fn(),
  bank: vi.fn(),
  apply: vi.fn(),
  create: vi.fn(),
  link: vi.fn(),
  kyc: vi.fn(),
  addServices: vi.fn(),
}))

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'sid' }) }) }))
vi.mock('@/lib/auth/owner-session', () => ({ OWNER_COOKIE: 'owner_sid', resolveOwnerSession: m.owner }))
vi.mock('@/lib/auth/session-signals-request', () => ({ extractSessionSignals: () => ({}) }))
vi.mock('@/lib/tenant-registry', () => ({
  createTenant: m.create,
  linkOwnerTenant: m.link,
  hasVerifiedBank: m.bank,
  saveSubscriptionId: vi.fn(),
  listPlans: vi.fn(),
  getOwnerTenants: m.tenants,
  saveKyc: m.kyc,
  markDraftSubmitted: vi.fn(),
  getDraft: vi.fn().mockResolvedValue({ data: {} }),
  saveDraft: vi.fn(),
  saveIntegrationCredential: vi.fn(),
  updateOwnerName: vi.fn(),
  hasService: (t: { service_types?: string[] | null }, s: string) => (t.service_types ?? ['store']).includes(s),
  applyStoreUpgrade: m.apply,
  addTenantServices: m.addServices,
}))
vi.mock('@/lib/shared/ecom-emails', () => ({ sendKycSubmittedEmail: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@controller/lib/k8s/capacity', () => ({ dedicatedCapacityError: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/shipping/delhivery', () => ({ verifyDelhiveryToken: vi.fn() }))

import { POST } from '@controller/app/api/(ecom)/ecom/onboard/submit/route'

const SERVICES = { id: 't-1', slug: 'acme', service_types: ['messaging'], store_request: null, status: 'active' }
const BODY = {
  planSlug: 'basic',
  displayName: 'Acme',
  slug: 'acme',
  ownerName: 'Aloys',
  businessName: 'Acme Pvt Ltd',
  businessType: 'pvt_ltd',
  pan: 'ABCDE1234F',
  businessAddress: '1 MG Road, Bengaluru 560001',
  gstNumber: '29ABCDE1234F1Z5',
  warehouse: { originPincode: '560001', sellerPhone: '9876543210', sellerAddress: '1 MG Road' },
  legalsAccepted: true,
}
const req = (body: unknown) =>
  new NextRequest('https://ecom.jeffistores.in/api/ecom/onboard/submit', { method: 'POST', body: JSON.stringify(body) })

describe('onboard submit — store upgrade on a services workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.owner.mockResolvedValue({ id: 'o-1', email: 'o@acme.test' })
    m.tenants.mockResolvedValue([SERVICES])
    m.bank.mockResolvedValue(true)
    m.apply.mockResolvedValue({ ok: true })
  })

  it('updates the existing tenant and queues the store for review without adding store', async () => {
    const res = await POST(req(BODY))
    expect(res.status).toBe(200)
    expect(m.apply).toHaveBeenCalledWith('t-1', expect.objectContaining({ planSlug: 'basic' }))
    expect(m.create).not.toHaveBeenCalled()
    expect(m.link).not.toHaveBeenCalled()
    expect(m.addServices).not.toHaveBeenCalled()
    expect(m.kyc).toHaveBeenCalledWith('t-1', 'o-1', expect.objectContaining({ review_again: true, pan: 'ABCDE1234F' }))
  })

  it('rejects without a verified bank account', async () => {
    m.bank.mockResolvedValue(false)
    const res = await POST(req(BODY))
    expect(res.status).toBe(400)
    expect(m.apply).not.toHaveBeenCalled()
  })

  it('rejects without the legal terms', async () => {
    const res = await POST(req({ ...BODY, legalsAccepted: false }))
    expect(res.status).toBe(400)
    expect(m.apply).not.toHaveBeenCalled()
  })

  it('still refuses a second application while one is open', async () => {
    m.tenants.mockResolvedValue([{ ...SERVICES, store_request: 'pending_approval' }])
    const res = await POST(req(BODY))
    expect(res.status).toBe(400)
    expect(m.apply).not.toHaveBeenCalled()
  })
})
