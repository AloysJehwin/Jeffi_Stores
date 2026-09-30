import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/tenant-registry', () => ({
  approveKyc: vi.fn(),
  getTenant: vi.fn(),
  listPlans: vi.fn(),
  getKyc: vi.fn(),
  getOwnerById: vi.fn(),
  getDraft: vi.fn(),
  saveSubscriptionId: vi.fn(),
  saveLinkedAccountId: vi.fn(),
  getOwnerBankAccount: vi.fn(),
  getOwnerBankWithRoute: vi.fn(),
  persistLinkedAccountToOwnerBank: vi.fn(),
}))

vi.mock('@/lib/payments/razorpay-subscriptions', () => ({
  createRazorpaySubscription: vi.fn(),
}))

vi.mock('@/lib/payments/razorpay-route', () => ({
  createLinkedAccount: vi.fn(),
  createRouteStakeholder: vi.fn(),
  configureRouteSettlement: vi.fn(),
  mapBusinessType: vi.fn((t: string) => t),
  inferProfileCategory: vi.fn(() => ({ category: 'ecommerce', subcategory: 'others' })),
  normalizeIndianPhone: vi.fn((p: string | null | undefined) =>
    p && /\d{10}/.test(String(p)) ? String(p).replace(/\D/g, '').slice(-10) : null
  ),
  // Real rule: the PAN's 4th character must match the declared business type. Mirrored here
  // rather than stubbed true so the approval path is exercised with a realistic verdict.
  isValidCompanyPan: vi.fn((pan: string | null | undefined, type: string) => {
    const chars: Record<string, string[]> = {
      partnership: ['F'],
      llp: ['F'],
      private_limited: ['C'],
      public_limited: ['C'],
      ngo: ['T', 'A', 'B'],
      proprietorship: [],
      not_yet_registered: [],
    }
    const p = String(pan ?? '')
      .trim()
      .toUpperCase()
    return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(p) && (chars[type]?.includes(p[3]) ?? false)
  }),
}))

vi.mock('@/lib/shared/ecom-emails', () => ({
  sendKycApprovedEmail: vi.fn().mockResolvedValue(undefined),
}))

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { POST } from '@/app/api/admin/ecom/kyc/[tenantId]/approve/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import {
  approveKyc,
  getTenant,
  listPlans,
  getKyc,
  getOwnerById,
  getDraft,
  saveSubscriptionId,
  saveLinkedAccountId,
  getOwnerBankAccount,
  getOwnerBankWithRoute,
  persistLinkedAccountToOwnerBank,
} from '@/lib/tenant-registry'
import { createRazorpaySubscription } from '@/lib/payments/razorpay-subscriptions'
import {
  createLinkedAccount,
  createRouteStakeholder,
  configureRouteSettlement,
  mapBusinessType,
  inferProfileCategory,
  normalizeIndianPhone,
} from '@/lib/payments/razorpay-route'
import { sendKycApprovedEmail } from '@/lib/shared/ecom-emails'

// ---------------------------------------------------------------------------
// Helpers / fixtures
// ---------------------------------------------------------------------------

const TENANT_ID = 'tnt-0001'
const ADMIN = { adminId: 'admin-1', email: 'admin@jeffistores.in', role: 'super_admin', scopes: [] }

function postReq(body: unknown = {}) {
  return new NextRequest(
    new Request(`http://localhost/api/admin/ecom/kyc/${TENANT_ID}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  )
}

const params = { params: Promise.resolve({ tenantId: TENANT_ID }) }

const TENANT = {
  id: TENANT_ID,
  slug: 'acme',
  display_name: 'Acme Store',
  plan: 'basic',
  billing_interval: 'monthly',
  razorpay_linked_account_id: null,
}

const KYC = {
  owner_id: 'own-1',
  business_name: 'Acme Pvt Ltd',
  business_type: 'private_limited',
  product_categories: 'electronics',
  business_address: '42 Main Rd, Chennai, Tamil Nadu, 600001',
  pan: 'AABCU9603R',
  gst_number: '33AABCU9603R1ZM',
}

const OWNER = { email: 'owner@acme.com', name: 'Owner Person' }

const DRAFT = { data: { wh: { sellerPhone: '9123456780', originPincode: '600001' } } }

const BANK = {
  account_number: '000111222333',
  ifsc: 'HDFC0001234',
  verified_name: 'Acme Pvt Ltd',
  holder_name: 'Acme Pvt Ltd',
}

function primeHappyPath() {
  vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
  vi.mocked(getTenant).mockResolvedValue(TENANT as any)
  vi.mocked(getKyc).mockResolvedValue(KYC as any)
  vi.mocked(getOwnerById).mockResolvedValue(OWNER as any)
  vi.mocked(approveKyc).mockResolvedValue(undefined)
  vi.mocked(getDraft).mockResolvedValue(DRAFT as any)
  // Pure helpers: resetAllMocks() wipes the inline vi.mock factory impls, so re-establish them.
  vi.mocked(mapBusinessType).mockImplementation((t: string) => t as any)
  vi.mocked(inferProfileCategory).mockReturnValue({ category: 'ecommerce', subcategory: 'others' })
  vi.mocked(normalizeIndianPhone).mockImplementation((p: string | null | undefined) =>
    p && /\d{10}/.test(String(p)) ? String(p).replace(/\D/g, '').slice(-10) : null
  )
  vi.mocked(createLinkedAccount).mockResolvedValue('acc_link_123')
  vi.mocked(saveLinkedAccountId).mockResolvedValue(undefined)
  vi.mocked(createRouteStakeholder).mockResolvedValue(undefined as any)
  vi.mocked(getOwnerBankAccount).mockResolvedValue(BANK as any)
  vi.mocked(getOwnerBankWithRoute).mockResolvedValue(null as any)
  vi.mocked(persistLinkedAccountToOwnerBank).mockResolvedValue(undefined)
  vi.mocked(configureRouteSettlement).mockResolvedValue({ ok: true } as any)
  vi.mocked(listPlans).mockResolvedValue([{ slug: 'basic', name: 'Basic', tier: 1, monthly_price_inr: '499' }] as any)
  vi.mocked(createRazorpaySubscription).mockResolvedValue({
    subscriptionId: 'sub_123',
    shortUrl: 'https://rzp.io/i/checkout',
  } as any)
  vi.mocked(saveSubscriptionId).mockResolvedValue(undefined)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/admin/ecom/kyc/[tenantId]/approve', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    primeHappyPath()
  })

  // --- Auth ---

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await POST(postReq(), params)
    expect(res.status).toBe(401)
  })

  // --- Not found guards ---

  it('returns 404 when tenant not found', async () => {
    vi.mocked(getTenant).mockResolvedValue(null as any)
    const res = await POST(postReq(), params)
    expect(res.status).toBe(404)
    expect((await res.json()).error).toMatch(/Tenant not found/)
  })

  it('returns 404 when KYC record not found', async () => {
    vi.mocked(getKyc).mockResolvedValue(null as any)
    const res = await POST(postReq(), params)
    expect(res.status).toBe(404)
    expect((await res.json()).error).toMatch(/KYC record not found/)
  })

  it('returns 404 when owner not found', async () => {
    vi.mocked(getOwnerById).mockResolvedValue(null as any)
    const res = await POST(postReq(), params)
    expect(res.status).toBe(404)
    expect((await res.json()).error).toMatch(/Owner not found/)
  })

  // --- Happy path ---

  it('approves KYC, creates linked account + subscription, returns checkoutUrl', async () => {
    const res = await POST(postReq(), params)
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.checkoutUrl).toBe('https://rzp.io/i/checkout')
    expect(json.linkedAccountId).toBe('acc_link_123')
    expect(approveKyc).toHaveBeenCalledWith(TENANT_ID, ADMIN.email)
    expect(createLinkedAccount).toHaveBeenCalled()
    expect(saveLinkedAccountId).toHaveBeenCalledWith(TENANT_ID, 'acc_link_123')
    expect(configureRouteSettlement).toHaveBeenCalled()
    expect(createRazorpaySubscription).toHaveBeenCalled()
    expect(saveSubscriptionId).toHaveBeenCalled()
    expect(sendKycApprovedEmail).toHaveBeenCalled()
  })

  it('falls back to "admin" reviewer email when admin.email is absent', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue({ ...ADMIN, email: undefined } as any)
    const res = await POST(postReq(), params)
    expect(res.status).toBe(200)
    expect(approveKyc).toHaveBeenCalledWith(TENANT_ID, 'admin')
  })

  // --- Idempotent linked account: skip creation when tenant already has one ---

  it('skips linked-account creation when tenant already has razorpay_linked_account_id', async () => {
    vi.mocked(getTenant).mockResolvedValue({ ...TENANT, razorpay_linked_account_id: 'acc_existing' } as any)
    const res = await POST(postReq(), params)
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.linkedAccountId).toBe('acc_existing')
    expect(createLinkedAccount).not.toHaveBeenCalled()
  })

  // --- Non-fatal linked account paths ---

  it('continues (non-fatal) when there is no valid owner phone for the linked account', async () => {
    vi.mocked(getDraft).mockResolvedValue({ data: { wh: { sellerPhone: null } } } as any)
    const res = await POST(postReq(), params)
    const json = await res.json()
    // linked account creation is skipped/thrown, but subscription still succeeds
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.linkedAccountId).toBeNull()
    expect(createLinkedAccount).not.toHaveBeenCalled()
    expect(createRazorpaySubscription).toHaveBeenCalled()
  })

  it('continues when getDraft rejects (draft fetch is caught)', async () => {
    vi.mocked(getDraft).mockRejectedValue(new Error('draft db down'))
    const res = await POST(postReq(), params)
    expect(res.status).toBe(200)
    // no phone → linked account skipped, subscription proceeds
    expect(createLinkedAccount).not.toHaveBeenCalled()
  })

  it('continues (non-fatal) when createLinkedAccount throws', async () => {
    vi.mocked(createLinkedAccount).mockRejectedValue({ error: { description: 'KYC pending on Razorpay' } })
    const res = await POST(postReq(), params)
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.linkedAccountId).toBeNull()
    expect(createRazorpaySubscription).toHaveBeenCalled()
  })

  it('logs but continues when createRouteStakeholder throws', async () => {
    vi.mocked(createRouteStakeholder).mockRejectedValue({ message: 'stakeholder failed' })
    const res = await POST(postReq(), params)
    const json = await res.json()
    expect(res.status).toBe(200)
    // linked account was still saved despite stakeholder failure
    expect(saveLinkedAccountId).toHaveBeenCalled()
    expect(json.linkedAccountId).toBe('acc_link_123')
  })

  it('logs but continues when settlement config returns ok:false', async () => {
    vi.mocked(configureRouteSettlement).mockResolvedValue({ ok: false, error: 'invalid IFSC' } as any)
    const res = await POST(postReq(), params)
    expect(res.status).toBe(200)
    expect(configureRouteSettlement).toHaveBeenCalled()
  })

  it('logs but continues when owner has no bank account on file', async () => {
    vi.mocked(getOwnerBankAccount).mockResolvedValue(null as any)
    const res = await POST(postReq(), params)
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.linkedAccountId).toBe('acc_link_123')
    // settlement is never configured without a bank account
    expect(configureRouteSettlement).not.toHaveBeenCalled()
  })

  it('treats a rejected getOwnerBankAccount as no bank on file (caught → null)', async () => {
    vi.mocked(getOwnerBankAccount).mockRejectedValue(new Error('bank lookup down'))
    const res = await POST(postReq(), params)
    expect(res.status).toBe(200)
    expect(configureRouteSettlement).not.toHaveBeenCalled()
  })

  it('uses holder_name when verified_name is absent on the bank account', async () => {
    vi.mocked(getOwnerBankAccount).mockResolvedValue({ ...BANK, verified_name: null } as any)
    const res = await POST(postReq(), params)
    expect(res.status).toBe(200)
    const arg = vi.mocked(configureRouteSettlement).mock.calls[0][1]
    expect(arg.beneficiaryName).toBe(BANK.holder_name)
  })

  // --- Plan selection ---

  it('falls back to the first plan when tenant.plan does not match any plan slug', async () => {
    vi.mocked(getTenant).mockResolvedValue({ ...TENANT, plan: 'nonexistent' } as any)
    const res = await POST(postReq(), params)
    expect(res.status).toBe(200)
    const opts = vi.mocked(createRazorpaySubscription).mock.calls[0][0] as any
    expect(opts.planName).toBe('Basic')
  })

  // --- Subscription failure ---

  it('returns 500 with kycApproved:true when the subscription creation fails', async () => {
    vi.mocked(createRazorpaySubscription).mockRejectedValue(new Error('Razorpay 5xx'))
    const res = await POST(postReq(), params)
    const json = await res.json()
    expect(res.status).toBe(500)
    expect(json.ok).toBe(false)
    expect(json.kycApproved).toBe(true)
    expect(json.linkedAccountId).toBe('acc_link_123')
    expect(json.error).toMatch(/Razorpay subscription failed/)
    // approveKyc already ran before the subscription attempt
    expect(approveKyc).toHaveBeenCalled()
    expect(saveSubscriptionId).not.toHaveBeenCalled()
  })

  it('surfaces the raw thrown value when the subscription error has no message', async () => {
    // err?.message ?? err → falls back to stringifying the thrown value
    vi.mocked(createRazorpaySubscription).mockRejectedValue('plain string failure')
    const res = await POST(postReq(), params)
    const json = await res.json()
    expect(res.status).toBe(500)
    expect(json.error).toMatch(/plain string failure/)
  })

  it('refuses to create a linked account without a usable postal code', async () => {
    // Razorpay rejects a non-numeric postal code and aborts the whole linked-account create —
    // taking the stakeholder and settlement bank with it. Stripping digits from an address
    // with none yields '', which `??` does not catch, so "" used to be sent.
    vi.mocked(getDraft).mockResolvedValue({ data: { wh: { sellerPhone: '9123456780' } } } as any)
    vi.mocked(getKyc).mockResolvedValue({
      owner_id: 'own-1',
      business_name: 'Acme',
      business_type: 'private_limited',
      product_categories: null,
      business_address: 'fgugcijhvb',
      pan: null,
      gst_number: null,
    } as any)

    const res = await POST(postReq(), params)
    expect(res.status).toBe(200) // non-fatal: go-live still proceeds
    expect(vi.mocked(createLinkedAccount)).not.toHaveBeenCalled()
  })

  it('takes the postal code from the onboarding draft when the address has none', async () => {
    vi.mocked(getKyc).mockResolvedValue({
      owner_id: 'own-1',
      business_name: 'Acme',
      business_type: 'private_limited',
      product_categories: null,
      business_address: 'no digits here',
      pan: null,
      gst_number: null,
    } as any)

    await POST(postReq(), params)
    const arg = vi.mocked(createLinkedAccount).mock.calls[0][0] as any
    expect(arg.postalCode).toBe('600001')
  })

  it('falls back to a 6-digit PIN found in the address', async () => {
    vi.mocked(getDraft).mockResolvedValue({ data: { wh: { sellerPhone: '9123456780' } } } as any)
    vi.mocked(getKyc).mockResolvedValue({
      owner_id: 'own-1',
      business_name: 'Acme',
      business_type: 'private_limited',
      product_categories: null,
      business_address: '42 Main Rd, Chennai, TN, 641004',
      pan: null,
      gst_number: null,
    } as any)

    await POST(postReq(), params)
    const arg = vi.mocked(createLinkedAccount).mock.calls[0][0] as any
    expect(arg.postalCode).toBe('641004')
  })

  // --- Null-field fallbacks (exercises the ?? right-hand branches) ---

  it('uses tenant.display_name / owner.email fallbacks when kyc + owner fields are null', async () => {
    vi.mocked(getKyc).mockResolvedValue({
      owner_id: 'own-1',
      business_name: null,
      business_type: null,
      product_categories: null,
      business_address: null,
      pan: null,
      gst_number: null,
    } as any)
    vi.mocked(getOwnerById).mockResolvedValue({ email: 'owner@acme.com', name: null } as any)
    const res = await POST(postReq(), params)
    expect(res.status).toBe(200)
    const linkArg = vi.mocked(createLinkedAccount).mock.calls[0][0] as any
    // business_name null → falls back to tenant.display_name
    expect(linkArg.businessName).toBe(TENANT.display_name)
    expect(linkArg.legalBusinessName).toBe(TENANT.display_name)
    // owner.name null → falls back to owner.email
    expect(linkArg.ownerName).toBe('owner@acme.com')
    // pan null → ''; gst_number null → undefined; address null → parsed defaults
    expect(linkArg.pan).toBe('')
    expect(linkArg.gstNumber).toBeUndefined()
    expect(linkArg.city).toBe('India')
    // subscription still created with plan/interval fallbacks
    expect(createRazorpaySubscription).toHaveBeenCalled()
  })

  it('defaults plan slug and billing interval when tenant fields are null', async () => {
    vi.mocked(getTenant).mockResolvedValue({
      ...TENANT,
      plan: null,
      billing_interval: null,
    } as any)
    // no matching plan slug → first plan; interval null → 'monthly'
    const res = await POST(postReq(), params)
    expect(res.status).toBe(200)
    const opts = vi.mocked(createRazorpaySubscription).mock.calls[0][0] as any
    expect(opts.planSlug).toBe('basic')
    expect(opts.interval).toBe('monthly')
    expect(saveSubscriptionId).toHaveBeenCalledWith(TENANT_ID, 'sub_123', 'monthly', 'https://rzp.io/i/checkout')
  })

  it('uses the default ECOM base url for the callback when env var is unset', async () => {
    const prev = process.env.NEXT_PUBLIC_ECOM_URL
    delete process.env.NEXT_PUBLIC_ECOM_URL
    try {
      const res = await POST(postReq(), params)
      expect(res.status).toBe(200)
      const opts = vi.mocked(createRazorpaySubscription).mock.calls[0][0] as any
      expect(opts.callbackUrl).toContain('https://ecom.jeffistores.in/onboard/success')
    } finally {
      if (prev !== undefined) process.env.NEXT_PUBLIC_ECOM_URL = prev
    }
  })

  it('still returns 200 when the approval email send rejects (fire-and-forget, caught)', async () => {
    vi.mocked(sendKycApprovedEmail).mockRejectedValue(new Error('SMTP down'))
    const res = await POST(postReq(), params)
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(sendKycApprovedEmail).toHaveBeenCalled()
  })
})
