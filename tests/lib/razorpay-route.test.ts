/**
 * Tests for src/lib/razorpay-route.ts — Razorpay Route (POBO) linked-account
 * helpers used when a tenant's KYC is approved.
 *
 * The boundary is the Razorpay SDK: we mock ./razorpay's getRazorpayInstance() to
 * return a fake `rz` whose sub-clients (accounts / stakeholders / products /
 * transfers / api) are vi.fn()s we can drive. recordCodSettlement talks to the
 * control-plane pool, so ./tenant-registry is mocked too.
 *
 * These pin: phone normalization edge cases, the linked-account payload shape,
 * the stakeholder "already exists" idempotency branch, configureRouteSettlement
 * never throwing, transfer math (commission + Razorpay's own fees + delhivery), and the COD
 * ledger.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Razorpay SDK seam ─────────────────────────────────────────────────────────
const rz = {
  accounts: { create: vi.fn() },
  stakeholders: { create: vi.fn(), all: vi.fn() },
  products: { requestProductConfiguration: vi.fn(), edit: vi.fn() },
  transfers: { reverse: vi.fn() },
  payments: { fetch: vi.fn() },
  api: { post: vi.fn() },
}
vi.mock('@/lib/razorpay', () => ({ getRazorpayInstance: () => rz }))

// ── control-plane pool seam (recordCodSettlement) ─────────────────────────────
const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) }
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => pool }))

const baseInput = {
  businessName: 'Acme Traders',
  businessType: 'proprietorship' as const,
  legalBusinessName: 'Acme Traders Pvt',
  profileCategory: 'ecommerce',
  profileSubcategory: 'ecommerce_marketplace',
  ownerEmail: 'owner@acme.in',
  ownerPhone: '9876543210',
  ownerName: 'Owner One',
  pan: 'ABCPD1234E',
  streetAddress: '1 Main St',
  city: 'Chennai',
  state: 'TN',
  postalCode: '600001',
}

beforeEach(() => {
  vi.clearAllMocks()
  pool.query.mockResolvedValue({ rows: [] })
  delete process.env.PLATFORM_COMMISSION_PCT
})

// ── normalizeIndianPhone ────────────────────────────────────────────────────
describe('normalizeIndianPhone', () => {
  it('returns null for empty/nullish input', async () => {
    const { normalizeIndianPhone } = await import('@/lib/razorpay-route')
    expect(normalizeIndianPhone(null)).toBeNull()
    expect(normalizeIndianPhone(undefined)).toBeNull()
    expect(normalizeIndianPhone('')).toBeNull()
  })

  it('passes through a clean 10-digit mobile', async () => {
    const { normalizeIndianPhone } = await import('@/lib/razorpay-route')
    expect(normalizeIndianPhone('9876543210')).toBe('9876543210')
  })

  it('strips a +91 / 91 country code', async () => {
    const { normalizeIndianPhone } = await import('@/lib/razorpay-route')
    expect(normalizeIndianPhone('+91 98765 43210')).toBe('9876543210')
    expect(normalizeIndianPhone('919876543210')).toBe('9876543210')
  })

  it('strips a leading 0 (11-digit STD form)', async () => {
    const { normalizeIndianPhone } = await import('@/lib/razorpay-route')
    expect(normalizeIndianPhone('09876543210')).toBe('9876543210')
  })

  it('strips punctuation and spaces', async () => {
    const { normalizeIndianPhone } = await import('@/lib/razorpay-route')
    expect(normalizeIndianPhone('(98765)-43210')).toBe('9876543210')
  })

  it('returns null when the result does not start 6–9', async () => {
    const { normalizeIndianPhone } = await import('@/lib/razorpay-route')
    expect(normalizeIndianPhone('1234567890')).toBeNull()
    expect(normalizeIndianPhone('5555555555')).toBeNull()
  })

  it('returns null for a wrong-length number', async () => {
    const { normalizeIndianPhone } = await import('@/lib/razorpay-route')
    expect(normalizeIndianPhone('98765')).toBeNull()
    expect(normalizeIndianPhone('9876543210999')).toBeNull()
  })
})

// ── createLinkedAccount ─────────────────────────────────────────────────────
describe('createLinkedAccount', () => {
  it('creates the account and returns its id', async () => {
    rz.accounts.create.mockResolvedValue({ id: 'acc_123' })
    const { createLinkedAccount } = await import('@/lib/razorpay-route')
    const id = await createLinkedAccount(baseInput)
    expect(id).toBe('acc_123')
    const payload = rz.accounts.create.mock.calls[0][0]
    expect(payload).toMatchObject({
      email: 'owner@acme.in',
      type: 'route',
      legal_business_name: 'Acme Traders Pvt',
      business_type: 'proprietorship',
      contact_name: 'Owner One',
    })
    expect(payload.profile.addresses.registered).toMatchObject({ street1: '1 Main St', country: 'IN' })
  })

  // legal_info.pan is the company PAN, and Razorpay checks the PAN's 4th character (the holder
  // type) against the declared business type: "The company pan field is invalid for business
  // type: <type>". Both live provisioning failures were an individual PAN ('P') declared as a
  // proprietorship and then as a partnership.
  it('omits the company PAN when the holder character disagrees with the business type', async () => {
    rz.accounts.create.mockResolvedValue({ id: 'acc_p' })
    const { createLinkedAccount } = await import('@/lib/razorpay-route')
    // individual PAN ('P') declared as a partnership — the exact live failure
    await createLinkedAccount({ ...baseInput, businessType: 'partnership', pan: 'ABCPD1234E' })
    expect(rz.accounts.create.mock.calls[0][0]).not.toHaveProperty('legal_info')
  })

  it('sends the company PAN when the holder character agrees', async () => {
    rz.accounts.create.mockResolvedValue({ id: 'acc_c' })
    const { createLinkedAccount } = await import('@/lib/razorpay-route')
    await createLinkedAccount({ ...baseInput, businessType: 'private_limited', pan: 'ABCCD1234E' })
    expect(rz.accounts.create.mock.calls[0][0]).toMatchObject({ legal_info: { pan: 'ABCCD1234E' } })
  })

  it('normalises a lowercase / padded PAN before sending it', async () => {
    rz.accounts.create.mockResolvedValue({ id: 'acc_l' })
    const { createLinkedAccount } = await import('@/lib/razorpay-route')
    await createLinkedAccount({ ...baseInput, businessType: 'llp', pan: '  abcfd1234e ' })
    expect(rz.accounts.create.mock.calls[0][0]).toMatchObject({ legal_info: { pan: 'ABCFD1234E' } })
  })
})

// ── isValidCompanyPan — the rule that decides the above ─────────────────────
describe('isValidCompanyPan', () => {
  const cases: Array<[string, string, boolean, string]> = [
    // partnerships and LLPs hold a firm PAN ('F')
    ['ABCFD1234E', 'partnership',        true,  'firm PAN for a partnership'],
    ['ABCPD1234E', 'partnership',        false, 'individual PAN for a partnership (live failure)'],
    ['ABCCD1234E', 'partnership',        false, 'company PAN for a partnership'],
    ['ABCFD1234E', 'llp',                true,  'firm PAN for an LLP'],
    // companies hold 'C'
    ['ABCCD1234E', 'private_limited',    true,  'company PAN for a pvt ltd'],
    ['ABCCD1234E', 'public_limited',     true,  'company PAN for a public ltd'],
    ['ABCFD1234E', 'private_limited',    false, 'firm PAN for a pvt ltd'],
    // no entity PAN exists for these
    ['ABCPD1234E', 'proprietorship',     false, 'individual PAN for a proprietorship (live failure)'],
    ['ABCCD1234E', 'proprietorship',     false, 'even a company PAN for a proprietorship'],
    ['ABCFD1234E', 'not_yet_registered', false, 'unregistered business has none'],
    // NGOs may be a trust, association or body of individuals
    ['ABCTD1234E', 'ngo',                true,  'trust PAN for an NGO'],
    ['ABCAD1234E', 'ngo',                true,  'association PAN for an NGO'],
    ['ABCPD1234E', 'ngo',                false, 'individual PAN for an NGO'],
  ]
  it.each(cases)('%s + %s -> %s (%s)', async (pan, type, expected) => {
    const { isValidCompanyPan } = await import('@/lib/razorpay-route')
    expect(isValidCompanyPan(pan, type as any)).toBe(expected)
  })

  // A malformed PAN must never be forwarded — it fails the create just as a mismatch does.
  it.each([
    ['', 'empty'], ['   ', 'blank'], ['ABCF1234E', 'too short'], ['ABCFD1234EX', 'too long'],
    ['12CFD1234E', 'digits in the letter block'], ['ABCFD12X4E', 'letter in the digit block'],
    ['ABCFD1234', 'missing check letter'],
  ])('rejects a malformed PAN (%s — %s)', async (pan) => {
    const { isValidCompanyPan } = await import('@/lib/razorpay-route')
    expect(isValidCompanyPan(pan, 'partnership')).toBe(false)
  })

  it('rejects null and undefined', async () => {
    const { isValidCompanyPan } = await import('@/lib/razorpay-route')
    expect(isValidCompanyPan(null, 'partnership')).toBe(false)
    expect(isValidCompanyPan(undefined, 'partnership')).toBe(false)
  })

  // mapBusinessType() can only ever produce these, so every one must be covered by the table.
  it('covers every business type mapBusinessType can return', async () => {
    const { isValidCompanyPan, mapBusinessType } = await import('@/lib/razorpay-route')
    for (const kycType of ['proprietor', 'partnership', 'pvt_ltd', 'llp', 'other', 'anything-else']) {
      // must not throw, and must return a boolean rather than undefined
      expect(typeof isValidCompanyPan('ABCFD1234E', mapBusinessType(kycType))).toBe('boolean')
    }
  })

  it('omits legal_info when PAN is blank and defaults street2 to N/A', async () => {
    rz.accounts.create.mockResolvedValue({ id: 'acc_456' })
    const { createLinkedAccount } = await import('@/lib/razorpay-route')
    await createLinkedAccount({ ...baseInput, pan: '', streetAddress2: undefined })
    const payload = rz.accounts.create.mock.calls[0][0]
    expect(payload.legal_info).toBeUndefined()
    expect(payload.profile.addresses.registered.street2).toBe('N/A')
  })

  it('uses the provided street2 when present', async () => {
    rz.accounts.create.mockResolvedValue({ id: 'acc_789' })
    const { createLinkedAccount } = await import('@/lib/razorpay-route')
    await createLinkedAccount({ ...baseInput, streetAddress2: 'Suite 5' })
    expect(rz.accounts.create.mock.calls[0][0].profile.addresses.registered.street2).toBe('Suite 5')
  })
})

// ── createRouteStakeholder ──────────────────────────────────────────────────
describe('createRouteStakeholder', () => {
  it('creates a stakeholder and returns its id (with kyc.pan when supplied)', async () => {
    rz.stakeholders.create.mockResolvedValue({ id: 'sth_1' })
    const { createRouteStakeholder } = await import('@/lib/razorpay-route')
    const id = await createRouteStakeholder('acc_1', { name: 'Owner', email: 'owner@acme.test', pan: 'ABCPD1234E' })
    expect(id).toBe('sth_1')
    expect(rz.stakeholders.create).toHaveBeenCalledWith('acc_1', { name: 'Owner', email: 'owner@acme.test', kyc: { pan: 'ABCPD1234E' } })
  })

  it('omits kyc when no PAN is given', async () => {
    rz.stakeholders.create.mockResolvedValue({ id: 'sth_2' })
    const { createRouteStakeholder } = await import('@/lib/razorpay-route')
    await createRouteStakeholder('acc_1', { name: 'Owner', email: 'owner@acme.test' })
    expect(rz.stakeholders.create).toHaveBeenCalledWith('acc_1', { name: 'Owner', email: 'owner@acme.test' })
  })

  it('returns the existing stakeholder when Razorpay says it already exists', async () => {
    rz.stakeholders.create.mockRejectedValue({ error: { description: 'stakeholder already exists' } })
    rz.stakeholders.all.mockResolvedValue({ items: [{ id: 'sth_existing' }] })
    const { createRouteStakeholder } = await import('@/lib/razorpay-route')
    const id = await createRouteStakeholder('acc_1', { name: 'Owner', email: 'owner@acme.test' })
    expect(id).toBe('sth_existing')
  })

  it('re-throws the "already exists" error when the list lookup finds nothing', async () => {
    rz.stakeholders.create.mockRejectedValue({ message: 'already exists' })
    rz.stakeholders.all.mockResolvedValue({ items: [] })
    const { createRouteStakeholder } = await import('@/lib/razorpay-route')
    await expect(createRouteStakeholder('acc_1', { name: 'Owner', email: 'owner@acme.test' })).rejects.toMatchObject({ message: 'already exists' })
  })

  it('re-throws the "already exists" error when the list lookup itself fails', async () => {
    rz.stakeholders.create.mockRejectedValue({ message: 'already exists' })
    rz.stakeholders.all.mockRejectedValue(new Error('list boom'))
    const { createRouteStakeholder } = await import('@/lib/razorpay-route')
    await expect(createRouteStakeholder('acc_1', { name: 'Owner', email: 'owner@acme.test' })).rejects.toMatchObject({ message: 'already exists' })
  })

  it('re-throws a non-idempotent error unchanged', async () => {
    rz.stakeholders.create.mockRejectedValue(new Error('validation failed'))
    const { createRouteStakeholder } = await import('@/lib/razorpay-route')
    await expect(createRouteStakeholder('acc_1', { name: 'Owner', email: 'owner@acme.test' })).rejects.toThrow('validation failed')
    expect(rz.stakeholders.all).not.toHaveBeenCalled()
  })
})

// ── configureRouteSettlement — NEVER throws ─────────────────────────────────
describe('configureRouteSettlement', () => {
  it('requests + edits the product configuration and returns ok', async () => {
    rz.products.requestProductConfiguration.mockResolvedValue({ id: 'cfg_1' })
    rz.products.edit.mockResolvedValue({})
    const { configureRouteSettlement } = await import('@/lib/razorpay-route')
    const out = await configureRouteSettlement('acc_1', { accountNumber: '111', ifsc: 'HDFC0000001', beneficiaryName: 'Owner' })
    expect(out).toEqual({ ok: true })
    expect(rz.products.edit).toHaveBeenCalledWith('acc_1', 'cfg_1', {
      settlements: { account_number: '111', ifsc_code: 'HDFC0000001', beneficiary_name: 'Owner' },
    })
  })

  it('returns ok:false when no product configuration id comes back', async () => {
    rz.products.requestProductConfiguration.mockResolvedValue({})
    const { configureRouteSettlement } = await import('@/lib/razorpay-route')
    const out = await configureRouteSettlement('acc_1', { accountNumber: null, ifsc: null, beneficiaryName: null })
    expect(out).toEqual({ ok: false, error: 'no product configuration id returned' })
    expect(rz.products.edit).not.toHaveBeenCalled()
  })

  it('captures a thrown error into { ok:false, error } instead of throwing', async () => {
    rz.products.requestProductConfiguration.mockRejectedValue({ error: { description: 'test-key not allowed' } })
    const { configureRouteSettlement } = await import('@/lib/razorpay-route')
    const out = await configureRouteSettlement('acc_1', { accountNumber: null, ifsc: null, beneficiaryName: null })
    expect(out.ok).toBe(false)
    expect(out.error).toBe('test-key not allowed')
  })

  it('falls back to err.message when there is no error.description', async () => {
    rz.products.requestProductConfiguration.mockRejectedValue(new Error('network down'))
    const { configureRouteSettlement } = await import('@/lib/razorpay-route')
    const out = await configureRouteSettlement('acc_1', { accountNumber: null, ifsc: null, beneficiaryName: null })
    expect(out.error).toBe('network down')
  })
})

// ── transferToLinkedAccount — the commission math ───────────────────────────
// Razorpay debits the platform twice: the gateway fee on the captured payment (read from the
// payment's `fee`, GST already included) and a transfer fee on the amount moved. Both come out
// of the tenant's share so the platform keeps its commission whole.
describe('transferToLinkedAccount', () => {
  beforeEach(() => {
    rz.payments.fetch.mockResolvedValue({ fee: 2360, tax: 360 })
  })

  // Shipping is NOT withheld here — it is charged once from the prepaid wallet at the real
  // invoiced amount. Withholding the estimate here too billed every prepaid order twice.
  it('deducts commission, the real gateway fee and the transfer fee — but NOT delhivery', async () => {
    rz.api.post.mockResolvedValue({ items: [{ id: 'trf_1', status: 'processed' }] })
    const { transferToLinkedAccount } = await import('@/lib/razorpay-route')
    const out = await transferToLinkedAccount({
      paymentId: 'pay_1', grossAmountPaise: 100000, linkedAccountId: 'acc_1',
      delhiveryChargePaise: 2000, orderId: 'o-1', tenantSlug: 'acme',
    })
    // 100000 - 5000 commission - 2360 gateway = 92640 (delhivery NOT deducted)
    // transfer fee = round(92640 * 0.0025 * 1.18) = 273 → 92367
    expect(out).toEqual({
      transferId: 'trf_1', amount: 92367, linkedAccountId: 'acc_1', status: 'processed',
      gatewayFeePaise: 2360, transferFeePaise: 273, platformCommissionPaise: 5000,
    })
    expect(rz.payments.fetch).toHaveBeenCalledWith('pay_1')
    const body = rz.api.post.mock.calls[0][0]
    expect(body.url).toBe('/payments/pay_1/transfers')
    expect(body.data.transfers[0]).toMatchObject({ account: 'acc_1', amount: 92367, currency: 'INR' })
    // The caller may still pass delhiveryChargePaise; it must not reduce the tenant's share.
    expect(body.data.transfers[0].notes).toMatchObject({
      platform_commission: 5000, gateway_fee: 2360, transfer_fee: 273, delhivery_charge: 0,
    })
  })

  // A UPI payment costs far less than a card, so estimating would over-deduct from the tenant.
  it('uses the payment\'s actual fee rather than a flat rate', async () => {
    rz.payments.fetch.mockResolvedValue({ fee: 140, tax: 21 })
    rz.api.post.mockResolvedValue({ items: [{ id: 'trf_u', status: 'processed' }] })
    const { transferToLinkedAccount } = await import('@/lib/razorpay-route')
    const out = await transferToLinkedAccount({
      paymentId: 'pay_upi', grossAmountPaise: 100000, linkedAccountId: 'acc_1',
    })
    expect(out.gatewayFeePaise).toBe(140)
    expect(out.amount).toBe(94580)  // 100000-5000-140 = 94860, less 280 transfer fee
  })

  // The payment already succeeded; abandoning the transfer would strand the tenant's money.
  it('falls back to an estimated gateway fee when the payment cannot be read', async () => {
    rz.payments.fetch.mockRejectedValue(new Error('razorpay down'))
    rz.api.post.mockResolvedValue({ items: [{ id: 'trf_f', status: 'processed' }] })
    const { transferToLinkedAccount } = await import('@/lib/razorpay-route')
    const out = await transferToLinkedAccount({
      paymentId: 'pay_3', grossAmountPaise: 100000, linkedAccountId: 'acc_1',
    })
    expect(out.gatewayFeePaise).toBe(2360)  // 2% + 18% GST
    expect(out.transferId).toBe('trf_f')
  })

  it('never sends a negative amount (clamped at 0) and defaults transfer fields', async () => {
    rz.api.post.mockResolvedValue({ items: [] })
    const { transferToLinkedAccount } = await import('@/lib/razorpay-route')
    const out = await transferToLinkedAccount({
      paymentId: 'pay_2', grossAmountPaise: 1000, linkedAccountId: 'acc_2', delhiveryChargePaise: 5000,
    })
    expect(out).toMatchObject({ transferId: '', amount: 0, linkedAccountId: 'acc_2', status: 'created' })
    // orderId / tenantSlug default to '' in notes
    expect(rz.api.post.mock.calls[0][0].data.transfers[0].notes.order_id).toBe('')
  })

  it('honours a custom PLATFORM_COMMISSION_PCT read at import time', async () => {
    vi.resetModules()
    process.env.PLATFORM_COMMISSION_PCT = '10'
    rz.api.post.mockResolvedValue({ items: [{ id: 'trf_x', status: 'processed' }] })
    try {
      const { transferToLinkedAccount } = await import('@/lib/razorpay-route')
      const out = await transferToLinkedAccount({ paymentId: 'p', grossAmountPaise: 100000, linkedAccountId: 'a' })
      // 100000 - 10000 commission - 2360 gateway = 87640, less 259 transfer fee
      expect(out.amount).toBe(87381)
    } finally {
      // Must run even when the assertion fails: the env and the reset module graph are captured
      // at import time, so leaking them silently changes the commission in every later test.
      delete process.env.PLATFORM_COMMISSION_PCT
      vi.resetModules()
    }
  })
})

// ── reverseTransfer ─────────────────────────────────────────────────────────
describe('reverseTransfer', () => {
  it('reverses the full amount when none is specified', async () => {
    rz.transfers.reverse.mockResolvedValue({})
    const { reverseTransfer } = await import('@/lib/razorpay-route')
    await reverseTransfer('trf_1')
    expect(rz.transfers.reverse).toHaveBeenCalledWith('trf_1', { amount: undefined })
  })

  it('reverses a partial amount when specified', async () => {
    rz.transfers.reverse.mockResolvedValue({})
    const { reverseTransfer } = await import('@/lib/razorpay-route')
    await reverseTransfer('trf_1', 5000)
    expect(rz.transfers.reverse).toHaveBeenCalledWith('trf_1', { amount: 5000 })
  })
})

// ── recordCodSettlement — control-plane ledger ──────────────────────────────
describe('recordCodSettlement', () => {
  it('writes a tenant_transactions row and the settlement_ledger entries', async () => {
    const { recordCodSettlement } = await import('@/lib/razorpay-route')
    await recordCodSettlement({
      tenantId: 't-1', tenantSlug: 'acme', orderRef: 'ORD-1',
      grossAmountInr: 1000, actualDelhiveryChargeInr: 50,
    })
    // txn + base ledger + the delhivery row (no wallet debit on this order)
    expect(pool.query).toHaveBeenCalledTimes(3)
    const [txnSql, txnParams] = pool.query.mock.calls[0]
    expect(txnSql).toMatch(/INSERT INTO tenant_transactions/)
    // gross 1000 → commission 5% = 50 → tenant share = 1000 - 50 - 50 = 900
    expect(txnParams).toEqual(['t-1', 'ORD-1', 1000, 900, 50])
    const [ledgerSql] = pool.query.mock.calls[1]
    expect(ledgerSql).toMatch(/INSERT INTO settlement_ledger/)
  })

  // Regression: the wallet already debited the real courier cost for this AWB, so deducting it
  // here as well billed the tenant twice for the same shipment.
  it('does NOT deduct shipping again when the wallet already billed it', async () => {
    const { recordCodSettlement } = await import('@/lib/razorpay-route')
    await recordCodSettlement({
      tenantId: 't-1', tenantSlug: 'acme', orderRef: 'ORD-9',
      grossAmountInr: 1000, actualDelhiveryChargeInr: 50,
      walletBilled: true,
    })
    // tenant share = 1000 - 50 commission, with NO shipping deduction
    const [, txnParams] = pool.query.mock.calls[0]
    expect(txnParams).toEqual(['t-1', 'ORD-9', 1000, 950, 50])
    // and no delhivery ledger row is written
    expect(pool.query).toHaveBeenCalledTimes(2)
  })

  it('swallows a DB error (best-effort ledger, never throws)', async () => {
    pool.query.mockRejectedValue(new Error('db down'))
    const { recordCodSettlement } = await import('@/lib/razorpay-route')
    await expect(recordCodSettlement({
      tenantId: 't-1', tenantSlug: 'acme', orderRef: 'ORD-2',
      grossAmountInr: 500, actualDelhiveryChargeInr: 10,
    })).resolves.toBeUndefined()
  })
})

// ── mapBusinessType / inferProfileCategory ──────────────────────────────────
describe('mapBusinessType', () => {
  it('maps known KYC types', async () => {
    const { mapBusinessType } = await import('@/lib/razorpay-route')
    expect(mapBusinessType('proprietor')).toBe('proprietorship')
    expect(mapBusinessType('partnership')).toBe('partnership')
    expect(mapBusinessType('pvt_ltd')).toBe('private_limited')
    expect(mapBusinessType('llp')).toBe('llp')
    expect(mapBusinessType('other')).toBe('not_yet_registered')
  })

  it('falls back to not_yet_registered for an unknown type', async () => {
    const { mapBusinessType } = await import('@/lib/razorpay-route')
    expect(mapBusinessType('mystery')).toBe('not_yet_registered')
  })
})

describe('inferProfileCategory', () => {
  it('classifies electronics / fashion / food / health', async () => {
    const { inferProfileCategory } = await import('@/lib/razorpay-route')
    expect(inferProfileCategory('Electronics & gadgets')).toEqual({ category: 'ecommerce', subcategory: 'electronics_and_furniture' })
    expect(inferProfileCategory('Fashion apparel')).toEqual({ category: 'ecommerce', subcategory: 'fashion_and_lifestyle' })
    expect(inferProfileCategory('Groceries and food')).toEqual({ category: 'food', subcategory: 'online_food_ordering' })
    expect(inferProfileCategory('Health & beauty')).toEqual({ category: 'healthcare', subcategory: 'pharmacy' })
  })

  it('defaults to generic e-commerce for null / unrecognised categories', async () => {
    const { inferProfileCategory } = await import('@/lib/razorpay-route')
    expect(inferProfileCategory(null)).toEqual({ category: 'ecommerce', subcategory: 'ecommerce_marketplace' })
    expect(inferProfileCategory('random stuff')).toEqual({ category: 'ecommerce', subcategory: 'ecommerce_marketplace' })
  })
})
