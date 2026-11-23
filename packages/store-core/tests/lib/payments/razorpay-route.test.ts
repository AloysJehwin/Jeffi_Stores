import { describe, it, expect, vi, beforeEach } from 'vitest'

// Pin the fee env to defaults BEFORE import so the module constants are deterministic.
process.env.PLATFORM_COMMISSION_PCT = '5'
process.env.DAILY_PAYOUT_SURCHARGE_PCT = '5'
process.env.ROUTE_TRANSFER_FEE_PCT = '0.25'
process.env.GST_PCT = '18'
process.env.RAZORPAY_GATEWAY_FEE_PCT = '2'

const rz: any = {}
vi.mock('@/lib/payments/razorpay', () => ({ getRazorpayInstance: () => rz }))

import {
  PLATFORM_COMMISSION_PCT,
  DAILY_PAYOUT_SURCHARGE_PCT,
  ROUTE_TRANSFER_FEE_PCT,
  commissionPct,
  normalizeIndianPhone,
  isValidCompanyPan,
  createLinkedAccount,
  updateLinkedAccount,
  createRouteStakeholder,
  configureRouteSettlement,
  markLinkedAccountDeprovisioned,
  transferToLinkedAccount,
  reverseTransfer,
  fetchTransfersForPayment,
  fetchTransfer,
  fetchTransfersForSettlement,
  fetchLinkedSettlement,
  mapBusinessType,
  inferProfileCategory,
} from '@/lib/payments/razorpay-route'

beforeEach(() => {
  for (const k of Object.keys(rz)) delete rz[k]
})

describe('constants + commissionPct', () => {
  it('reflect the default env', () => {
    expect(PLATFORM_COMMISSION_PCT).toBeCloseTo(0.05, 10)
    expect(DAILY_PAYOUT_SURCHARGE_PCT).toBeCloseTo(0.05, 10)
    expect(ROUTE_TRANSFER_FEE_PCT).toBeCloseTo(0.0025, 10)
  })
  it('adds the daily surcharge only when daily', () => {
    expect(commissionPct(false)).toBeCloseTo(0.05, 10)
    expect(commissionPct(undefined)).toBeCloseTo(0.05, 10)
    expect(commissionPct(true)).toBeCloseTo(0.1, 10)
  })
})

describe('normalizeIndianPhone (pure)', () => {
  it('nullish / empty', () => {
    expect(normalizeIndianPhone(null)).toBeNull()
    expect(normalizeIndianPhone(undefined)).toBeNull()
    expect(normalizeIndianPhone('')).toBeNull()
  })
  it('strips +91 / 91 country code', () => {
    expect(normalizeIndianPhone('+91 98765 43210')).toBe('9876543210')
    expect(normalizeIndianPhone('919876543210')).toBe('9876543210')
  })
  it('strips a leading 0', () => {
    expect(normalizeIndianPhone('09876543210')).toBe('9876543210')
  })
  it('accepts a clean 10-digit mobile', () => {
    expect(normalizeIndianPhone('6000000000')).toBe('6000000000')
  })
  it('rejects non-mobile prefix and wrong length', () => {
    expect(normalizeIndianPhone('1234567890')).toBeNull() // starts <6
    expect(normalizeIndianPhone('98765')).toBeNull()
    expect(normalizeIndianPhone('98765432100')).toBeNull() // 11 digits, no leading 0
  })
})

describe('isValidCompanyPan (pure)', () => {
  it('false for bad shape / nullish', () => {
    expect(isValidCompanyPan(null, 'partnership')).toBe(false)
    expect(isValidCompanyPan('ABC', 'partnership')).toBe(false)
    expect(isValidCompanyPan('AAAAA1234Z', 'partnership')).toBe(false) // 4th char A not F
  })
  it('firm PAN (F) valid for partnership and llp only', () => {
    expect(isValidCompanyPan('AAAFA1234Z', 'partnership')).toBe(true)
    expect(isValidCompanyPan('aaafa1234z', 'llp')).toBe(true) // lowercased input ok
    expect(isValidCompanyPan('AAAFA1234Z', 'private_limited')).toBe(false)
  })
  it('company PAN (C) valid for pvt/public limited', () => {
    expect(isValidCompanyPan('AAACA1234Z', 'private_limited')).toBe(true)
    expect(isValidCompanyPan('AAACA1234Z', 'public_limited')).toBe(true)
  })
  it('ngo accepts T/A/B', () => {
    expect(isValidCompanyPan('AAATA1234Z', 'ngo')).toBe(true)
    expect(isValidCompanyPan('AAAAA1234Z', 'ngo')).toBe(true)
    expect(isValidCompanyPan('AAABA1234Z', 'ngo')).toBe(true)
    expect(isValidCompanyPan('AAACA1234Z', 'ngo')).toBe(false)
  })
  it('proprietorship / not_yet_registered have no company PAN', () => {
    expect(isValidCompanyPan('AAACA1234Z', 'proprietorship')).toBe(false)
    expect(isValidCompanyPan('AAAFA1234Z', 'not_yet_registered')).toBe(false)
  })
})

function input(over: Partial<any> = {}): any {
  return {
    businessName: 'Acme',
    businessType: 'private_limited',
    legalBusinessName: 'Acme Pvt Ltd',
    profileCategory: 'ecommerce',
    profileSubcategory: 'ecommerce_marketplace',
    ownerEmail: 'o@x.com',
    ownerPhone: '9876543210',
    ownerName: 'Owner',
    pan: 'AAACA1234Z',
    gstNumber: '27AAACA1234Z1Z5',
    streetAddress: 'Road 1',
    city: 'Mumbai',
    state: ' mh ',
    postalCode: '400001',
    ...over,
  }
}

describe('createLinkedAccount', () => {
  it('creates and returns the account id; legal_info carries valid PAN+GST, state upcased', async () => {
    const create = vi.fn<(...a: any[]) => any>(async () => ({ id: 'acc_123' }))
    rz.accounts = { create }
    const id = await createLinkedAccount(input())
    expect(id).toBe('acc_123')
    const payload = create.mock.calls[0][0]
    expect(payload.email).toBe('o@x.com')
    expect(payload.type).toBe('route')
    expect(payload.business_type).toBe('private_limited')
    expect(payload.legal_info).toEqual({ pan: 'AAACA1234Z', gst: '27AAACA1234Z1Z5' })
    expect(payload.profile.addresses.registered.state).toBe('MH')
    expect(payload.profile.addresses.registered.street2).toBe('N/A')
  })
  it('omits legal_info when PAN mismatches type and GST invalid', async () => {
    const create = vi.fn<(...a: any[]) => any>(async () => ({ id: 'acc_x' }))
    rz.accounts = { create }
    await createLinkedAccount(input({ pan: 'AAAPA1234Z', gstNumber: 'bad' }))
    expect(create.mock.calls[0][0].legal_info).toBeUndefined()
  })
  it('recovers an existing account id from the duplicate-email error and PATCHes it', async () => {
    const edit = vi.fn(async () => ({}))
    rz.accounts = {
      create: vi.fn(async () => { throw { error: { description: 'Merchant email already exists for account - acc_OLD1' } } }),
      edit,
    }
    const id = await createLinkedAccount(input())
    expect(id).toBe('acc_OLD1')
    expect(edit).toHaveBeenCalledWith('acc_OLD1', expect.any(Object))
  })
  it('prefixes acc_ when the error id lacks it', async () => {
    rz.accounts = {
      create: vi.fn(async () => { throw { message: 'already exists for account - OLD2' } }),
      edit: vi.fn(async () => { throw new Error('patch failed') }), // swallowed
    }
    expect(await createLinkedAccount(input())).toBe('acc_OLD2')
  })
  it('rethrows an unrecognised error', async () => {
    rz.accounts = { create: vi.fn(async () => { throw new Error('boom') }) }
    await expect(createLinkedAccount(input())).rejects.toThrow('boom')
  })
})

describe('updateLinkedAccount', () => {
  it('PATCHes the profile payload (no business_type/email)', async () => {
    const edit = vi.fn<(...a: any[]) => any>(async () => ({}))
    rz.accounts = { edit }
    await updateLinkedAccount('acc_1', input())
    const [id, payload] = edit.mock.calls[0]
    expect(id).toBe('acc_1')
    expect(payload).not.toHaveProperty('business_type')
    expect(payload).not.toHaveProperty('email')
    expect(payload.contact_name).toBe('Owner')
  })
})

describe('createRouteStakeholder', () => {
  it('creates with kyc.pan when pan given', async () => {
    const create = vi.fn(async () => ({ id: 'sth_1' }))
    rz.stakeholders = { create }
    const id = await createRouteStakeholder('acc_1', { name: 'N', email: 'e@x.com', pan: 'AAAPA1234Z' })
    expect(id).toBe('sth_1')
    expect(create).toHaveBeenCalledWith('acc_1', { name: 'N', email: 'e@x.com', kyc: { pan: 'AAAPA1234Z' } })
  })
  it('omits kyc when no pan', async () => {
    const create = vi.fn<(...a: any[]) => any>(async () => ({ id: 'sth_2' }))
    rz.stakeholders = { create }
    await createRouteStakeholder('acc_1', { name: 'N', email: 'e@x.com' })
    expect(create.mock.calls[0][1]).toEqual({ name: 'N', email: 'e@x.com' })
  })
  it('on "already exists" fetches the first existing stakeholder', async () => {
    rz.stakeholders = {
      create: vi.fn(async () => { throw { error: { description: 'stakeholder already exists' } } }),
      all: vi.fn(async () => ({ items: [{ id: 'sth_old' }] })),
    }
    expect(await createRouteStakeholder('acc_1', { name: 'N', email: 'e@x.com' })).toBe('sth_old')
  })
  it('rethrows if already-exists but no existing found', async () => {
    rz.stakeholders = {
      create: vi.fn(async () => { throw { message: 'already exists' } }),
      all: vi.fn(async () => null),
    }
    await expect(createRouteStakeholder('acc_1', { name: 'N', email: 'e@x.com' })).rejects.toBeTruthy()
  })
  it('rethrows other errors', async () => {
    rz.stakeholders = { create: vi.fn(async () => { throw new Error('nope') }) }
    await expect(createRouteStakeholder('acc_1', { name: 'N', email: 'e@x.com' })).rejects.toThrow('nope')
  })
})

describe('configureRouteSettlement (never throws)', () => {
  it('ok when product config + edit succeed', async () => {
    const requestProductConfiguration = vi.fn(async () => ({ id: 'cfg_1' }))
    const edit = vi.fn(async () => ({}))
    rz.products = { requestProductConfiguration, edit }
    const r = await configureRouteSettlement('acc_1', { accountNumber: '123', ifsc: 'HDFC0001', beneficiaryName: 'N' })
    expect(r).toEqual({ ok: true })
    expect(edit).toHaveBeenCalledWith('acc_1', 'cfg_1', { settlements: { account_number: '123', ifsc_code: 'HDFC0001', beneficiary_name: 'N' } })
  })
  it('fails cleanly when no config id', async () => {
    rz.products = { requestProductConfiguration: vi.fn(async () => ({})), edit: vi.fn() }
    expect(await configureRouteSettlement('acc_1', { accountNumber: null, ifsc: null, beneficiaryName: null })).toEqual({ ok: false, error: 'no product configuration id returned' })
  })
  it('catches thrown errors into {ok:false,error}', async () => {
    rz.products = { requestProductConfiguration: vi.fn(async () => { throw { error: { description: 'test key' } } }) }
    expect(await configureRouteSettlement('acc_1', { accountNumber: null, ifsc: null, beneficiaryName: null })).toEqual({ ok: false, error: 'test key' })
  })
})

describe('markLinkedAccountDeprovisioned (never throws)', () => {
  it('edits notes + customer_facing name', async () => {
    const edit = vi.fn<(...a: any[]) => any>(async () => ({}))
    rz.accounts = { edit }
    const r = await markLinkedAccountDeprovisioned('acc_1', 'myslug')
    expect(r).toEqual({ ok: true })
    const payload = edit.mock.calls[0][1]
    expect(payload.notes.deprovisioned_slug).toBe('myslug')
    expect(payload.customer_facing_business_name).toBe('[closed] myslug')
  })
  it('returns error on failure', async () => {
    rz.accounts = { edit: vi.fn(async () => { throw new Error('x') }) }
    expect((await markLinkedAccountDeprovisioned('acc_1', 's')).ok).toBe(false)
  })
})

describe('transferToLinkedAccount — commission/fee math', () => {
  it('computes exact paise with real gateway fee, weekly commission', async () => {
    // gross ₹1000 = 100000 paise. commission 5% = 5000. gatewayFee from payment.fee = 2360.
    // beforeTransferFee = 100000 - 5000 - 2360 = 92640.
    // transferFee = round(92640 * 0.0025 * 1.18) = round(273.288) = 273.
    // tenantShare = 92640 - 273 = 92367.
    const post = vi.fn<(...a: any[]) => any>(async () => ({ items: [{ id: 'trf_1', status: 'created' }] }))
    rz.payments = { fetch: vi.fn(async () => ({ fee: 2360 })) }
    rz.api = { post }
    const r = await transferToLinkedAccount({ paymentId: 'pay_1', grossAmountPaise: 100000, linkedAccountId: 'acc_1', dailyPayout: false, orderId: 'ord', tenantSlug: 'slug' })
    expect(r.platformCommissionPaise).toBe(5000)
    expect(r.gatewayFeePaise).toBe(2360)
    expect(r.transferFeePaise).toBe(273)
    expect(r.amount).toBe(92367)
    expect(r.transferId).toBe('trf_1')
    expect(r.status).toBe('created')
    const body = post.mock.calls[0][0]
    expect(body.url).toBe('/payments/pay_1/transfers')
    const t = body.data.transfers[0]
    expect(t.account).toBe('acc_1')
    expect(t.amount).toBe(92367)
    expect(t.on_hold).toBe(true)
    expect(t.notes.platform_commission).toBe(5000)
    expect(t.notes.gateway_fee).toBe(2360)
  })
  it('daily payout => 10% commission', async () => {
    // gross 100000, commission 10% = 10000. gatewayFee falls back: round(100000*0.02*1.18)=2360.
    rz.payments = { fetch: vi.fn(async () => { throw new Error('no fee') }) }
    rz.api = { post: vi.fn(async () => ({ items: [{ id: 'trf_2', status: 'processed' }] })) }
    const r = await transferToLinkedAccount({ paymentId: 'pay_2', grossAmountPaise: 100000, linkedAccountId: 'acc_1', dailyPayout: true })
    expect(r.platformCommissionPaise).toBe(10000)
    expect(r.gatewayFeePaise).toBe(2360) // fallback estimate
  })
  it('defaults transferId/status when items empty', async () => {
    rz.payments = { fetch: vi.fn(async () => ({ fee: 0 })) }
    rz.api = { post: vi.fn(async () => ({ items: [] })) }
    const r = await transferToLinkedAccount({ paymentId: 'pay_3', grossAmountPaise: 1000, linkedAccountId: 'acc_1' })
    expect(r.transferId).toBe('')
    expect(r.status).toBe('created')
  })
  it('clamps share to >=0 when fees exceed gross', async () => {
    rz.payments = { fetch: vi.fn(async () => ({ fee: 5000 })) }
    rz.api = { post: vi.fn(async () => ({ items: [{ id: 't', status: 'created' }] })) }
    const r = await transferToLinkedAccount({ paymentId: 'p', grossAmountPaise: 100, linkedAccountId: 'a' })
    expect(r.amount).toBe(0)
  })
})

describe('reverseTransfer', () => {
  it('calls transfers.reverse with amount', async () => {
    const reverse = vi.fn(async () => ({ id: 'rvr_1' }))
    rz.transfers = { reverse }
    const r = await reverseTransfer('trf_1', 500)
    expect(reverse).toHaveBeenCalledWith('trf_1', { amount: 500 })
    expect(r).toEqual({ id: 'rvr_1' })
  })
})

describe('fetchTransfersForPayment', () => {
  it('maps items from a list response', async () => {
    rz.payments = { fetchTransfer: vi.fn(async () => ({ items: [{ id: 'trf_1', amount: 100, amount_reversed: 10, status: 'processed', notes: { a: 1 } }, { bad: true }] })) }
    const r = await fetchTransfersForPayment('pay_1')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.transfers).toEqual([{ id: 'trf_1', amount: 100, amountReversed: 10, status: 'processed', notes: { a: 1 } }])
    }
  })
  it('handles a bare array response and missing fields', async () => {
    rz.payments = { fetchTransfer: vi.fn(async () => [{ id: 'trf_2' }]) }
    const r = await fetchTransfersForPayment('pay_2')
    expect(r.ok && r.transfers[0]).toMatchObject({ id: 'trf_2', amount: 0, amountReversed: 0, status: undefined, notes: undefined })
  })
  it('ok:false on throw', async () => {
    rz.payments = { fetchTransfer: vi.fn(async () => { throw new Error('rz down') }) }
    const r = await fetchTransfersForPayment('pay_3')
    expect(r).toEqual({ ok: false, error: 'rz down' })
  })
})

describe('fetchTransfer', () => {
  it('returns the entity', async () => {
    rz.transfers = { fetch: vi.fn(async () => ({ id: 't' })) }
    expect(await fetchTransfer('t')).toEqual({ id: 't' })
  })
  it('null on throw', async () => {
    rz.transfers = { fetch: vi.fn(async () => { throw new Error('x') }) }
    expect(await fetchTransfer('t')).toBeNull()
  })
})

describe('fetchTransfersForSettlement', () => {
  it('paginates until a short page', async () => {
    const all = vi.fn<(...a: any[]) => any>()
      .mockResolvedValueOnce({ items: new Array(100).fill(0).map((_, i) => ({ id: `t${i}` })) })
      .mockResolvedValueOnce({ items: [{ id: 'last' }] })
    rz.transfers = { all }
    const out = await fetchTransfersForSettlement('setl_1')
    expect(out).toHaveLength(101)
    expect(all).toHaveBeenCalledTimes(2)
    expect(all.mock.calls[0][0]).toMatchObject({ recipient_settlement_id: 'setl_1', count: 100, skip: 0 })
  })
  it('null on throw', async () => {
    rz.transfers = { all: vi.fn(async () => { throw new Error('x') }) }
    expect(await fetchTransfersForSettlement('setl_1')).toBeNull()
  })
})

describe('fetchLinkedSettlement', () => {
  it('returns settlement/linked/transfer from the expanded transfer', async () => {
    rz.transfers = { all: vi.fn(async () => ({ items: [{ id: 'trf_1', recipient: 'acc_1', recipient_settlement: { id: 'setl_1' } }] })) }
    expect(await fetchLinkedSettlement('setl_1')).toEqual({ settlement: { id: 'setl_1' }, linkedAccountId: 'acc_1', transferId: 'trf_1' })
  })
  it('null when no expanded settlement', async () => {
    rz.transfers = { all: vi.fn(async () => ({ items: [{ id: 'trf_1' }] })) }
    expect(await fetchLinkedSettlement('setl_1')).toBeNull()
  })
  it('null on throw', async () => {
    rz.transfers = { all: vi.fn(async () => { throw new Error('x') }) }
    expect(await fetchLinkedSettlement('setl_1')).toBeNull()
  })
})

describe('mapBusinessType', () => {
  it('maps known kyc types and defaults', () => {
    expect(mapBusinessType('proprietor')).toBe('proprietorship')
    expect(mapBusinessType('partnership')).toBe('partnership')
    expect(mapBusinessType('pvt_ltd')).toBe('private_limited')
    expect(mapBusinessType('llp')).toBe('llp')
    expect(mapBusinessType('other')).toBe('not_yet_registered')
    expect(mapBusinessType('whatever')).toBe('not_yet_registered')
  })
})

describe('inferProfileCategory', () => {
  it('each branch', () => {
    expect(inferProfileCategory('electronics')).toEqual({ category: 'ecommerce', subcategory: 'electronics_and_furniture' })
    expect(inferProfileCategory('gadget')).toEqual({ category: 'ecommerce', subcategory: 'electronics_and_furniture' })
    expect(inferProfileCategory('fashion')).toEqual({ category: 'ecommerce', subcategory: 'fashion_and_lifestyle' })
    expect(inferProfileCategory('apparel')).toEqual({ category: 'ecommerce', subcategory: 'fashion_and_lifestyle' })
    expect(inferProfileCategory('food')).toEqual({ category: 'food', subcategory: 'online_food_ordering' })
    expect(inferProfileCategory('groceries')).toEqual({ category: 'food', subcategory: 'online_food_ordering' })
    expect(inferProfileCategory('health')).toEqual({ category: 'healthcare', subcategory: 'pharmacy' })
    expect(inferProfileCategory('beauty')).toEqual({ category: 'healthcare', subcategory: 'pharmacy' })
    expect(inferProfileCategory('jewellery')).toEqual({ category: 'ecommerce', subcategory: 'jewellery_and_watch_stores' })
    expect(inferProfileCategory('watches')).toEqual({ category: 'ecommerce', subcategory: 'jewellery_and_watch_stores' })
    expect(inferProfileCategory('pet supplies')).toEqual({ category: 'ecommerce', subcategory: 'pet_products' })
    expect(inferProfileCategory('automotive')).toEqual({ category: 'ecommerce', subcategory: 'automobile_parts_and_equipements' })
    expect(inferProfileCategory('agriculture')).toEqual({ category: 'ecommerce', subcategory: 'agriculture' })
    expect(inferProfileCategory('gardening')).toEqual({ category: 'ecommerce', subcategory: 'agriculture' })
    expect(inferProfileCategory(null)).toEqual({ category: 'ecommerce', subcategory: 'ecommerce_marketplace' })
    expect(inferProfileCategory('misc')).toEqual({ category: 'ecommerce', subcategory: 'ecommerce_marketplace' })
  })
})
