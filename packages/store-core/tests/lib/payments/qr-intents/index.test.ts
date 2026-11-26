import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  resolveRequestTenant: vi.fn(),
  withTransaction: vi.fn(),
}))
vi.mock('@/lib/payments/razorpay', () => ({ getRazorpayInstanceFor: vi.fn() }))
vi.mock('@/lib/payments/upi-qr', () => ({ cropRazorpayQr: vi.fn(async () => 'data:image/png;base64,QR') }))
vi.mock('@/lib/payments/capture', () => ({ recordPaymentDetails: vi.fn(async () => {}), routeCapturedPayment: vi.fn(async () => {}) }))
vi.mock('@/lib/integrations/resolve', () => ({ resolveRazorpayCreds: vi.fn(async () => ({ isOwn: false })) }))
vi.mock('@/lib/payments/webhook-tenant', () => ({
  isFlagship: (t: any) => !t?.tenantId || t.tenantId === '00000000-0000-0000-0000-000000000000',
}))
vi.mock('@/lib/shared/admin-notify', () => ({ createAdminNotification: vi.fn(async () => {}) }))
vi.mock('@/lib/catalog/brand', () => ({ currentBrandNameAsync: vi.fn(async () => 'Acme') }))
vi.mock('@/lib/payments/qr-intents/kinds', () => {
  const kind = () => ({ validate: vi.fn(), finalise: vi.fn(), existing: vi.fn(async () => null) })
  return {
    KINDS: { invoice: kind(), quotation_convert: kind(), invoice_draft_finalise: kind(), cash_sale: kind() },
    resultLinks: (k: string, id: string) =>
      k === 'cash_sale' ? { resultUrl: `/admin/cash-sale/${id}/view`, invoiceUrl: `/r/${id}` } : { resultUrl: `/admin/invoices/${id}/view`, invoiceUrl: `/i/${id}` },
  }
})

import {
  applyQrIntentPayment,
  cancelQrIntent,
  createQrIntent,
  finaliseQrIntent,
  getQrIntent,
  intentPaymentIds,
  markQrIntentPaid,
  pollQrIntent,
  qrIntentView,
  QrIntentError,
  sweepQrIntents,
} from '@/lib/payments/qr-intents'
import { KINDS } from '@/lib/payments/qr-intents/kinds'
import { query, queryMany, queryOne, resolveRequestTenant, withTransaction } from '@/lib/shared/db'
import { getRazorpayInstanceFor } from '@/lib/payments/razorpay'
import { cropRazorpayQr } from '@/lib/payments/upi-qr'
import { recordPaymentDetails, routeCapturedPayment } from '@/lib/payments/capture'
import { resolveRazorpayCreds } from '@/lib/integrations/resolve'
import { createAdminNotification } from '@/lib/shared/admin-notify'

const ID = '11111111-1111-4111-8111-111111111111'
const ACTOR = { adminId: 'a1', role: 'manager', scopes: ['invoices:write'] }
const TENANT = { tenantId: 't1', slug: 'acme' }

const rzp = { qrCode: { create: vi.fn(), close: vi.fn(), fetchAllPayments: vi.fn() } }

// A one-row payment_intents table behind the mocked db helpers.
let row: any
const base = (over: Record<string, unknown> = {}) => ({
  id: ID,
  kind: 'invoice',
  payload: { customerName: 'Ravi' },
  amount_paise: '11800',
  razorpay_qr_id: 'qr_1',
  qr_image_url: 'data:qr',
  status: 'pending',
  razorpay_payment_id: null,
  payment: null,
  result_ref: null,
  error: null,
  actor: ACTOR,
  created_by: 'a1',
  expires_at: new Date(Date.now() + 600_000).toISOString(),
  paid_at: null,
  finalised_at: null,
  checked_at: null,
  created_at: new Date().toISOString(),
  ...over,
})
const client = { query: vi.fn() }
const sqls = () => [...vi.mocked(query).mock.calls, ...vi.mocked(queryOne).mock.calls].map(c => String(c[0]))

function fakeDb() {
  vi.mocked(queryOne).mockImplementation(async (sql: string, p: any[] = []) => {
    if (sql.includes('INSERT INTO payment_intents')) return { id: ID } as any
    if (sql.startsWith('SELECT * FROM payment_intents WHERE id')) return row ? { ...row } : null
    if (sql.includes('SELECT id FROM payment_intents WHERE id = $1'))
      return row && p[0] === row.id && (row.razorpay_qr_id === null || row.razorpay_qr_id === p[1]) ? ({ id: row.id } as any) : null
    if (sql.includes('checked_at = NOW()')) {
      if (row.checked_at) return null
      row.checked_at = new Date()
      return { id: ID } as any
    }
    if (sql.includes('razorpay_payment_id = $2, payment = $4')) {
      if (!['pending', 'expired', 'cancelled'].includes(row.status) || row.razorpay_payment_id) return null
      const mismatch = Number(row.amount_paise) !== p[2]
      row = {
        ...row,
        status: row.status === 'cancelled' || mismatch ? 'failed' : 'paid',
        error: row.status === 'cancelled' ? 'Paid after the QR was cancelled, so nothing was created' : mismatch ? 'Paid wrong amount' : null,
        razorpay_payment_id: p[1],
        payment: JSON.parse(p[3]),
        paid_at: new Date().toISOString(),
      }
      return { ...row }
    }
    if (sql.includes('invoice_number AS n')) return { n: 'JS/26-27/007' } as any
    return null
  })
  vi.mocked(query).mockImplementation(async (sql: string, p: any[] = []) => {
    if (sql.includes("status = 'expired'") && row.status === 'pending') row.status = 'expired'
    if (sql.includes("status = 'cancelled'") && row.status === 'pending') row.status = 'cancelled'
    if (sql.includes("status = 'failed'") && sql.includes('QR not created')) row.status = 'failed'
    if (sql.includes('razorpay_qr_id = $2, qr_image_url = $3')) Object.assign(row ?? {}, { razorpay_qr_id: p[1], qr_image_url: p[2] })
    return { rows: [], rowCount: 1 } as any
  })
  client.query.mockImplementation(async (sql: string, p: any[] = []) => {
    if (sql.includes('FOR UPDATE')) return { rows: row ? [{ ...row }] : [] }
    if (sql.includes("status = 'finalised'")) {
      row = { ...row, status: 'finalised', result_ref: p[1], error: null }
      return { rows: [{ ...row }] }
    }
    if (sql.includes("status = 'failed'")) {
      row = { ...row, status: 'failed', error: p[1] }
      return { rows: [{ ...row }] }
    }
    return { rows: [] }
  })
  vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(client))
}

beforeEach(() => {
  vi.clearAllMocks()
  row = base()
  fakeDb()
  vi.mocked(resolveRequestTenant).mockResolvedValue(TENANT as any)
  vi.mocked(getRazorpayInstanceFor).mockResolvedValue({ instance: rzp } as any)
  rzp.qrCode.create.mockResolvedValue({ id: 'qr_new', image_url: 'https://rzp/poster.png' })
  rzp.qrCode.close.mockResolvedValue({})
  rzp.qrCode.fetchAllPayments.mockResolvedValue({ items: [] })
  for (const k of Object.values(KINDS) as any[]) {
    k.validate.mockReset()
    k.finalise.mockReset()
    k.existing.mockReset().mockResolvedValue(null)
  }
})

describe('createQrIntent', () => {
  it('validates first, then makes a one-time fixed-amount QR on the store keys', async () => {
    row = null
    vi.mocked(KINDS.invoice.validate).mockResolvedValue({ amountPaise: 11800, payload: { a: 1, paymentMode: 'upi_qr' }, label: 'Invoice for Ravi' })
    const out = await createQrIntent({ kind: 'invoice', payload: { a: 1 }, actor: ACTOR })

    expect(KINDS.invoice.validate).toHaveBeenCalledWith({ a: 1 }, ACTOR)
    const insert = vi.mocked(queryOne).mock.calls.find(c => String(c[0]).includes('INSERT INTO payment_intents'))!
    expect(insert[1]).toEqual(['invoice', JSON.stringify({ a: 1, paymentMode: 'upi_qr' }), 11800, JSON.stringify(ACTOR), 'a1', expect.any(Date)])
    expect(getRazorpayInstanceFor).toHaveBeenCalledWith('t1')
    const args = rzp.qrCode.create.mock.calls[0][0]
    expect(args).toMatchObject({
      type: 'upi_qr',
      usage: 'single_use',
      fixed_amount: true,
      payment_amount: 11800,
      notes: { payment_intent_id: ID, kind: 'invoice', tenant_id: 't1', tenant_slug: 'acme' },
    })
    // Razorpay wants close_by at least 15 minutes out.
    expect(args.close_by - Math.floor(Date.now() / 1000)).toBeGreaterThanOrEqual(15 * 60)
    expect(cropRazorpayQr).toHaveBeenCalledWith('https://rzp/poster.png')
    expect(query).toHaveBeenCalledWith(expect.stringContaining('razorpay_qr_id = $2, qr_image_url = $3'), [ID, 'qr_new', 'data:image/png;base64,QR'])
    expect(out).toEqual({ intentId: ID, qrImageUrl: 'data:image/png;base64,QR', amount: 118, expiresAt: expect.any(String) })
    expect(new Date(out.expiresAt).getTime() - Date.now()).toBeGreaterThan(14 * 60_000)
  })

  it('uses the poster URL when cropping fails, and names no store for the flagship', async () => {
    vi.mocked(resolveRequestTenant).mockResolvedValue(null)
    vi.mocked(cropRazorpayQr).mockRejectedValueOnce(new Error('fetch failed'))
    vi.mocked(KINDS.cash_sale.validate).mockResolvedValue({ amountPaise: 500, payload: {}, label: 'Counter sale' })
    const out = await createQrIntent({ kind: 'cash_sale', payload: {}, actor: ACTOR })
    expect(out.qrImageUrl).toBe('https://rzp/poster.png')
    expect(rzp.qrCode.create.mock.calls[0][0].notes).toEqual({ payment_intent_id: ID, kind: 'cash_sale' })
  })

  it('refuses a payload that is not an object, and a zero total', async () => {
    await expect(createQrIntent({ kind: 'invoice', payload: [1], actor: ACTOR })).rejects.toMatchObject({ status: 400 })
    vi.mocked(KINDS.invoice.validate).mockResolvedValue({ amountPaise: 0, payload: {}, label: 'x' })
    await expect(createQrIntent({ kind: 'invoice', payload: {}, actor: ACTOR })).rejects.toThrow('Nothing to pay')
    expect(rzp.qrCode.create).not.toHaveBeenCalled()
  })

  it('passes the create call’s own refusal through (stock included) and makes nothing', async () => {
    vi.mocked(KINDS.invoice.validate).mockRejectedValue(new QrIntentError('Not enough stock: Widget', 409))
    await expect(createQrIntent({ kind: 'invoice', payload: {}, actor: ACTOR })).rejects.toMatchObject({ status: 409, message: 'Not enough stock: Widget' })
    expect(sqls().some(s => s.includes('INSERT INTO payment_intents'))).toBe(false)
  })

  it('fails the intent with a 502 when Razorpay will not make the QR', async () => {
    vi.mocked(KINDS.invoice.validate).mockResolvedValue({ amountPaise: 100, payload: {}, label: 'x' })
    rzp.qrCode.create.mockRejectedValue({ error: { description: 'Authentication failed' } })
    await expect(createQrIntent({ kind: 'invoice', payload: {}, actor: ACTOR })).rejects.toMatchObject({ status: 502 })
    expect(query).toHaveBeenCalledWith(expect.stringContaining("status = 'failed'"), [ID, 'QR not created: Authentication failed'])
  })
})

describe('markQrIntentPaid', () => {
  it('records a captured payment once', async () => {
    expect(await markQrIntentPaid(ID, { id: 'pay_1', amount: 11800, status: 'captured' })).toBe('paid')
    expect(row.razorpay_payment_id).toBe('pay_1')
    expect(await markQrIntentPaid(ID, { id: 'pay_1', amount: 11800, status: 'captured' })).toBeNull()
  })

  it('ignores a payment that is not captured or has no id', async () => {
    expect(await markQrIntentPaid(ID, { id: 'pay_1', amount: 11800, status: 'authorized' })).toBeNull()
    expect(await markQrIntentPaid(ID, {})).toBeNull()
    expect(queryOne).not.toHaveBeenCalled()
  })

  it('fails a cancelled intent that was paid anyway and tells finance', async () => {
    row.status = 'cancelled'
    expect(await markQrIntentPaid(ID, { id: 'pay_1', amount: 11800 })).toBe('failed')
    expect(createAdminNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'qr_intent_failed', severity: 'critical', entityId: ID }))
  })
})

describe('finaliseQrIntent', () => {
  const paid = (over: Record<string, unknown> = {}) => {
    row = base({ status: 'paid', razorpay_payment_id: 'pay_1', payment: { id: 'pay_1', method: 'upi' }, paid_at: new Date().toISOString(), ...over })
  }

  it('creates the document with the payment, then settles it like any store payment', async () => {
    paid()
    vi.mocked(KINDS.invoice.finalise).mockResolvedValue({ id: 'ord_1', ref: 'OFF-1', totalInr: 118 })
    const out = await finaliseQrIntent(ID, { store: TENANT })

    expect(client.query.mock.calls[0][0]).toMatch(/FOR UPDATE$/)
    expect(KINDS.invoice.finalise).toHaveBeenCalledWith(expect.objectContaining({ id: ID }), {
      razorpayPaymentId: 'pay_1',
      razorpayQrId: 'qr_1',
      amountPaise: 11800,
      intentId: ID,
    })
    expect(out).toMatchObject({ status: 'finalised', result_ref: 'ord_1' })
    expect(routeCapturedPayment).toHaveBeenCalledWith({ store: TENANT, paymentId: 'pay_1', totalAmountInr: 118, orderId: 'ord_1', orderRef: 'OFF-1' })
    expect(recordPaymentDetails).toHaveBeenCalledWith({ id: 'pay_1', method: 'upi' }, expect.objectContaining({ account: 'platform' }))
  })

  it('books an own-account store’s payment as own, and a cash sale by its sale number without payment details', async () => {
    paid()
    vi.mocked(resolveRazorpayCreds).mockResolvedValueOnce({ isOwn: true } as any)
    vi.mocked(KINDS.invoice.finalise).mockResolvedValue({ id: 'ord_1', ref: 'OFF-1', totalInr: 118 })
    await finaliseQrIntent(ID, { store: TENANT })
    expect(recordPaymentDetails).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ account: 'own' }))

    vi.clearAllMocks()
    fakeDb()
    paid({ kind: 'cash_sale' })
    vi.mocked(KINDS.cash_sale.finalise).mockResolvedValue({ id: 'sale_1', ref: 'CS-1', totalInr: 118 })
    await finaliseQrIntent(ID)
    // No store passed: the request's store (the admin pod or the sweep).
    expect(routeCapturedPayment).toHaveBeenCalledWith({ store: TENANT, paymentId: 'pay_1', totalAmountInr: 118, orderId: 'sale_1', orderRef: 'CS-1' })
    expect(recordPaymentDetails).not.toHaveBeenCalled()
  })

  it('adopts the document a payment already made instead of creating another', async () => {
    paid()
    vi.mocked(KINDS.invoice.existing).mockResolvedValue({ id: 'ord_9', ref: 'OFF-9', totalInr: 118 })
    const out = await finaliseQrIntent(ID, { store: null })
    expect(KINDS.invoice.finalise).not.toHaveBeenCalled()
    expect(out).toMatchObject({ status: 'finalised', result_ref: 'ord_9' })
  })

  it('does nothing for an intent that is not paid (a duplicate webhook after it finalised)', async () => {
    paid({ status: 'finalised', result_ref: 'ord_1' })
    const out = await finaliseQrIntent(ID)
    expect(out).toMatchObject({ status: 'finalised' })
    expect(KINDS.invoice.finalise).not.toHaveBeenCalled()
    expect(routeCapturedPayment).not.toHaveBeenCalled()
  })

  it('fails the intent with the reason when the create fails after payment; nothing is settled or refunded', async () => {
    paid()
    vi.mocked(KINDS.invoice.finalise).mockRejectedValue(new QrIntentError('Not enough stock: Widget', 409))
    const out = await finaliseQrIntent(ID, { store: TENANT })
    expect(out).toMatchObject({ status: 'failed', error: 'Not enough stock: Widget', razorpay_payment_id: 'pay_1' })
    expect(routeCapturedPayment).not.toHaveBeenCalled()
    expect(createAdminNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'qr_intent_failed', link: 'https://dashboard.razorpay.com/app/payments/pay_1' }))
  })

  it('finalises when the create errored but its document exists (a lost response)', async () => {
    paid()
    vi.mocked(KINDS.invoice.finalise).mockRejectedValue(new Error('socket hang up'))
    vi.mocked(KINDS.invoice.existing).mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'ord_2', ref: 'OFF-2', totalInr: 118 })
    expect(await finaliseQrIntent(ID, { store: null })).toMatchObject({ status: 'finalised', result_ref: 'ord_2' })
  })

  it('skips a row another finaliser holds when asked to', async () => {
    paid()
    client.query.mockResolvedValueOnce({ rows: [] })
    expect(await finaliseQrIntent(ID, { skipLocked: true })).toBeNull()
    expect(client.query.mock.calls[0][0]).toMatch(/SKIP LOCKED$/)
  })
})

describe('applyQrIntentPayment (webhook)', () => {
  const QRE = { id: 'qr_1', notes: { payment_intent_id: ID } }

  it('is unmatched when the QR names no intent (no query), or another QR made it', async () => {
    expect(await applyQrIntentPayment({ id: 'qr_other' }, { id: 'pay_1' }, TENANT)).toBe('unmatched')
    expect(queryOne).not.toHaveBeenCalled()
    expect(await applyQrIntentPayment({ id: 'qr_other', notes: { payment_intent_id: ID } }, { id: 'pay_1' }, TENANT)).toBe('unmatched')
  })

  it('marks the intent paid and finalises it in the store; a duplicate webhook finalises nothing twice', async () => {
    vi.mocked(KINDS.invoice.finalise).mockResolvedValue({ id: 'ord_1', ref: 'OFF-1', totalInr: 118 })
    const pay = { id: 'pay_1', amount: 11800, status: 'captured' }
    expect(await applyQrIntentPayment(QRE, pay, TENANT)).toBe('paid')
    expect(row).toMatchObject({ status: 'finalised', result_ref: 'ord_1' })
    expect(routeCapturedPayment).toHaveBeenCalledTimes(1)

    expect(await applyQrIntentPayment(QRE, pay, TENANT)).toBe('already_paid')
    expect(KINDS.invoice.finalise).toHaveBeenCalledTimes(1)
    expect(routeCapturedPayment).toHaveBeenCalledTimes(1)
  })

  it('takes the intent its notes name when the QR id was never saved', async () => {
    row.razorpay_qr_id = null
    vi.mocked(KINDS.invoice.finalise).mockResolvedValue({ id: 'ord_1', ref: 'OFF-1', totalInr: 118 })
    expect(await applyQrIntentPayment({ id: 'qr_x', notes: { payment_intent_id: ID } }, { id: 'pay_1', amount: 11800 }, TENANT)).toBe('paid')
    expect(await applyQrIntentPayment({ id: 'qr_y', notes: { payment_intent_id: 'not-a-uuid' } }, { id: 'pay_2' }, TENANT)).toBe('unmatched')
  })

  it('a wrong amount fails the intent instead of creating the document', async () => {
    expect(await applyQrIntentPayment(QRE, { id: 'pay_1', amount: 100 }, TENANT)).toBe('paid')
    expect(row.status).toBe('failed')
    expect(KINDS.invoice.finalise).not.toHaveBeenCalled()
  })
})

describe('pollQrIntent', () => {
  it('returns null for an unknown or malformed id', async () => {
    expect(await pollQrIntent('nope')).toBeNull()
    row = null
    expect(await pollQrIntent(ID)).toBeNull()
  })

  it('asks Razorpay at most every few seconds and finalises a payment the webhook missed', async () => {
    rzp.qrCode.fetchAllPayments.mockResolvedValue({ items: [{ id: 'pay_f', status: 'failed' }, { id: 'pay_1', status: 'captured', amount: 11800 }] })
    vi.mocked(KINDS.invoice.finalise).mockResolvedValue({ id: 'ord_1', ref: 'OFF-1', totalInr: 118 })
    const out = await pollQrIntent(ID)
    expect(rzp.qrCode.fetchAllPayments).toHaveBeenCalledWith('qr_1')
    expect(out).toMatchObject({ status: 'finalised', razorpay_payment_id: 'pay_1' })

    row = base({ checked_at: new Date() })
    rzp.qrCode.fetchAllPayments.mockClear()
    expect(await pollQrIntent(ID)).toMatchObject({ status: 'pending' })
    expect(rzp.qrCode.fetchAllPayments).not.toHaveBeenCalled()
  })

  it('stays pending when Razorpay has nothing or cannot be asked', async () => {
    expect(await pollQrIntent(ID)).toMatchObject({ status: 'pending' })
    row.checked_at = null
    rzp.qrCode.fetchAllPayments.mockRejectedValue(new Error('down'))
    expect(await pollQrIntent(ID)).toMatchObject({ status: 'pending' })
  })

  it('expires an overdue intent and closes its QR', async () => {
    row = base({ expires_at: new Date(Date.now() - 1000).toISOString() })
    rzp.qrCode.close.mockRejectedValueOnce({ error: { description: 'QR code is already closed' } })
    expect(await pollQrIntent(ID)).toMatchObject({ status: 'expired' })
    expect(rzp.qrCode.close).toHaveBeenCalledWith('qr_1')
  })

  it('finalises a paid intent nobody finalised', async () => {
    row = base({ status: 'paid', razorpay_payment_id: 'pay_1', paid_at: new Date(Date.now() - 60_000).toISOString() })
    vi.mocked(KINDS.invoice.finalise).mockResolvedValue({ id: 'ord_1', ref: 'OFF-1', totalInr: 118 })
    expect(await pollQrIntent(ID)).toMatchObject({ status: 'finalised' })
    expect(client.query.mock.calls[0][0]).toMatch(/SKIP LOCKED$/)
  })

  it('leaves a just-paid intent to the webhook that is finalising it', async () => {
    row = base({ status: 'paid', razorpay_payment_id: 'pay_1', paid_at: new Date().toISOString() })
    expect(await pollQrIntent(ID)).toMatchObject({ status: 'paid' })
    expect(withTransaction).not.toHaveBeenCalled()
  })
})

describe('cancelQrIntent', () => {
  it('closes the QR and cancels', async () => {
    expect(await cancelQrIntent(ID)).toMatchObject({ status: 'cancelled' })
    expect(rzp.qrCode.close).toHaveBeenCalledWith('qr_1')
  })

  it('keeps a payment that landed before the close', async () => {
    rzp.qrCode.fetchAllPayments.mockResolvedValue({ items: [{ id: 'pay_1', status: 'captured', amount: 11800 }] })
    vi.mocked(KINDS.invoice.finalise).mockResolvedValue({ id: 'ord_1', ref: 'OFF-1', totalInr: 118 })
    expect(await cancelQrIntent(ID)).toMatchObject({ status: 'finalised' })
  })

  it('changes nothing on an intent that is no longer pending', async () => {
    row.status = 'finalised'
    expect(await cancelQrIntent(ID)).toMatchObject({ status: 'finalised' })
    expect(rzp.qrCode.close).not.toHaveBeenCalled()
  })
})

describe('qrIntentView', () => {
  it('names the document and its links once finalised', async () => {
    const v = await qrIntentView(base({ status: 'finalised', result_ref: 'ord_1' }) as any)
    expect(v).toMatchObject({
      status: 'finalised',
      amount: 118,
      resultRef: 'ord_1',
      resultUrl: '/admin/invoices/ord_1/view',
      invoiceUrl: '/i/ord_1',
      invoiceNumber: 'JS/26-27/007',
    })
    expect(queryOne).toHaveBeenCalledWith(expect.stringContaining('FROM orders'), ['ord_1'])
  })

  it('reads a cash sale’s number from cash_sales and shows a failure’s reason', async () => {
    await qrIntentView(base({ kind: 'cash_sale', status: 'finalised', result_ref: 'sale_1' }) as any)
    expect(queryOne).toHaveBeenCalledWith(expect.stringContaining('FROM cash_sales'), ['sale_1'])
    const v = await qrIntentView(base({ status: 'failed', error: 'Not enough stock' }) as any)
    expect(v).toMatchObject({ status: 'failed', error: 'Not enough stock' })
    expect(v.resultRef).toBeUndefined()
  })
})

describe('sweepQrIntents and helpers', () => {
  it('finalises confirmed payments, expires overdue QRs and retries stuck paid intents', async () => {
    const overdue = base({ id: '22222222-2222-4222-8222-222222222222', expires_at: new Date(Date.now() - 1000).toISOString() })
    vi.mocked(queryMany).mockResolvedValue([overdue] as any)
    row = { ...overdue }
    expect(await sweepQrIntents()).toBe(1)
    expect(row.status).toBe('expired')

    const stuck = base({ status: 'paid', razorpay_payment_id: 'pay_1' })
    vi.mocked(queryMany).mockResolvedValue([stuck] as any)
    row = { ...stuck }
    vi.mocked(KINDS.invoice.finalise).mockResolvedValue({ id: 'ord_1', ref: 'OFF-1', totalInr: 118 })
    expect(await sweepQrIntents()).toBe(1)

    const open = base()
    vi.mocked(queryMany).mockResolvedValue([open] as any)
    row = { ...open }
    expect(await sweepQrIntents()).toBe(0)
    // The sweep always asks Razorpay (no poll throttle).
    expect(rzp.qrCode.fetchAllPayments).toHaveBeenCalled()
  })

  it('lists the payments intents hold', async () => {
    expect(await intentPaymentIds([])).toEqual(new Set())
    vi.mocked(queryMany).mockResolvedValue([{ razorpay_payment_id: 'pay_1' }] as any)
    expect(await intentPaymentIds(['pay_1', 'pay_2'])).toEqual(new Set(['pay_1']))
    vi.mocked(queryMany).mockRejectedValue(new Error('no table'))
    expect(await intentPaymentIds(['pay_1'])).toEqual(new Set())
  })

  it('getQrIntent refuses a malformed id without a query', async () => {
    expect(await getQrIntent("1' OR 1=1")).toBeNull()
    expect(queryOne).not.toHaveBeenCalled()
  })
})
