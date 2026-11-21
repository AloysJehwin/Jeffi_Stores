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
  saveCompute: vi.fn(),
  planCompute: vi.fn(),
  flag: vi.fn(() => false),
  quote: vi.fn(),
  docs: vi.fn(),
  kybProfile: vi.fn(),
  kybDoc: vi.fn(),
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
vi.mock('@controller/lib/compute/catalog', () => ({ computeSpecEnabled: m.flag, getCatalog: vi.fn(), planCompute: m.planCompute }))
vi.mock('@controller/lib/compute/quote', () => ({ quoteForPlan: m.quote }))
vi.mock('@controller/lib/compute/store', () => ({ saveDesiredCompute: m.saveCompute }))
vi.mock('@controller/lib/catalog/compliance-docs', () => ({ saveComplianceDocuments: m.docs }))
vi.mock('@controller/lib/kyb/store', () => ({
  saveKybProfile: m.kybProfile,
  upsertKybDocument: m.kybDoc,
  listKybDocuments: vi.fn().mockResolvedValue([]),
  setOwnerNote: vi.fn(),
  setGstCertKey: vi.fn(),
}))
vi.mock('@controller/lib/kyb/analyze', () => ({ queueRecheck: vi.fn().mockResolvedValue({ count: 0, run: vi.fn() }) }))

import { POST } from '@controller/app/api/(ecom)/ecom/onboard/submit/route'
import { presetSpec, withDedicatedDb } from '@/lib/compute/presets'

const SERVICES = { id: 't-1', slug: 'acme', service_types: ['messaging'], store_request: null, status: 'active' }
const BODY = {
  planSlug: 'basic',
  displayName: 'Acme',
  slug: 'acme',
  ownerName: 'Aloys',
  businessName: 'Acme Traders',
  businessType: 'partnership',
  entityType: 'partnership',
  pan: 'AAPFU0939F',
  businessAddress: '1 MG Road, Mumbai, Maharashtra 400001',
  addressLine: '1 MG Road',
  city: 'Mumbai',
  state: 'Maharashtra',
  pincode: '400001',
  authorizedName: 'Aloys',
  authorizedDesignation: 'Partner',
  gstRegistered: true,
  gstNumber: '27AAPFU0939F1ZV',
  kybDocs: { pan_card: { s3Key: 'kyc/o-1/pan_card/p.pdf', fileName: 'pan.pdf' }, gst_cert: { s3Key: 'kyc/o-1/gst_cert/g.pdf', fileName: 'gst.pdf' } },
  warehouse: { originPincode: '560001', sellerPhone: '9876543210', sellerAddress: '1 MG Road' },
  legalsAccepted: true,
  compliance: { answers: { restricted: false, import: false } },
}
const req = (body: unknown) =>
  new NextRequest('https://ecom.jeffistores.in/api/ecom/onboard/submit', { method: 'POST', body: JSON.stringify(body) })

describe('onboard submit — store upgrade on a services workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.flag.mockReturnValue(false)
    m.quote.mockResolvedValue({ validation: { ok: true, errors: [] }, capacityError: null })
    m.owner.mockResolvedValue({ id: 'o-1', email: 'o@acme.test' })
    m.tenants.mockResolvedValue([SERVICES])
    m.bank.mockResolvedValue(true)
    m.apply.mockResolvedValue({ ok: true })
    m.docs.mockResolvedValue(undefined)
    m.planCompute.mockImplementation(async (slug: string) =>
      ({ basic: { slug, minPreset: 'basic', defaultPreset: 'basic' }, growth: { slug, minPreset: 'small', defaultPreset: 'small' } } as any)[slug] ?? null
    )
  })

  it('updates the existing tenant and queues the store for review without adding store', async () => {
    const res = await POST(req(BODY))
    expect(res.status).toBe(200)
    expect(m.apply).toHaveBeenCalledWith('t-1', expect.objectContaining({ planSlug: 'basic' }))
    expect(m.create).not.toHaveBeenCalled()
    expect(m.link).not.toHaveBeenCalled()
    expect(m.addServices).not.toHaveBeenCalled()
    expect(m.kyc).toHaveBeenCalledWith('t-1', 'o-1', expect.objectContaining({ review_again: true, pan: 'AAPFU0939F', gst_cert_s3_key: 'kyc/o-1/gst_cert/g.pdf' }))
    expect(m.kybProfile).toHaveBeenCalledWith('t-1', 'o-1', expect.objectContaining({ entityType: 'partnership', gstRegistered: true, gstin: '27AAPFU0939F1ZV', state: 'Maharashtra' }))
    expect(m.kybDoc).toHaveBeenCalledWith('t-1', 'o-1', expect.objectContaining({ docType: 'pan_card', number: 'AAPFU0939F', s3Key: 'kyc/o-1/pan_card/p.pdf' }))
  })

  it('always saves a priced compute row: Basic is the basic preset, even when a size was sent', async () => {
    const res = await POST(req({ ...BODY, compute: presetSpec('large') }))
    expect(res.status).toBe(200)
    expect(m.saveCompute).toHaveBeenCalledWith('t-1', presetSpec('basic'))
  })

  it("keeps Basic's server but takes its database choice when owners may choose", async () => {
    m.flag.mockReturnValue(true)
    const db = withDedicatedDb(presetSpec('basic'), 'basic').db
    const res = await POST(req({ ...BODY, compute: { ...presetSpec('large'), db } }))
    expect(res.status).toBe(200)
    expect(m.saveCompute).toHaveBeenCalledWith('t-1', { ...presetSpec('basic'), db })
    m.saveCompute.mockClear()
    await POST(req({ ...BODY, compute: presetSpec('large') }))
    expect(m.saveCompute).toHaveBeenCalledWith('t-1', presetSpec('basic'))
  })

  it("prices a paid plan at its floor size while owners can't choose one", async () => {
    const res = await POST(req({ ...BODY, planSlug: 'growth' }))
    expect(res.status).toBe(200)
    expect(m.saveCompute).toHaveBeenCalledWith('t-1', presetSpec('small'))
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

  it("files the licences under their category, and refuses another owner's upload", async () => {
    const iec = { s3Key: 'kyc/o-1/iec/a.pdf', fileName: 'iec.pdf', number: 'abcde12345' }
    const body = { ...BODY, compliance: { answers: { restricted: false, import: true }, docs: { iec } } }
    expect((await POST(req(body))).status).toBe(200)
    expect(m.docs).toHaveBeenCalledWith('t-1', 'o-1', [
      { docType: 'iec', category: 'General', number: 'ABCDE12345', expiresOn: null, s3Key: 'kyc/o-1/iec/a.pdf', fileName: 'iec.pdf' },
    ])
    m.apply.mockClear()
    const theirs = { ...body, compliance: { ...body.compliance, docs: { iec: { ...iec, s3Key: 'kyc/o-2/iec/a.pdf' } } } }
    expect((await POST(req(theirs))).status).toBe(400)
    expect(m.apply).not.toHaveBeenCalled()
  })

  it('still refuses a second application while one is open', async () => {
    m.tenants.mockResolvedValue([{ ...SERVICES, store_request: 'pending_approval' }])
    const res = await POST(req(BODY))
    expect(res.status).toBe(400)
    expect(m.apply).not.toHaveBeenCalled()
  })
})
