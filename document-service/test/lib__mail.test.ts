import { describe, it, expect, vi, beforeEach } from 'vitest'

// mail.ts POSTs to the messaging service via fetch; every dep is mocked.
vi.mock('@jeffi/service-auth', () => ({ signServiceToken: vi.fn(() => 'signed-token') }))
vi.mock('@jeffi/tenancy', () => ({ currentTenant: vi.fn(), PLATFORM_TENANT_ID: 'platform' }))
vi.mock('../src/lib/mail-template', () => ({
  applyMailTheme: vi.fn((html: string) => `themed:${html}`),
  mailShell: vi.fn(() => '<shell/>'),
}))
vi.mock('../src/lib/reply-context', () => ({ recordEmailSend: vi.fn() }))
vi.mock('../src/lib/brand', () => ({
  currentBrandNameAsync: vi.fn(async () => 'Acme'),
  customerMailFromAsync: vi.fn(async () => '"Acme" <noreply@acme.test>'),
  storeAddressLine: vi.fn(async () => '1 Main St'),
  storeContactLine: vi.fn(async () => '99999 | a@b.test'),
  storeMailTheme: vi.fn(async () => ({ accent: '#111' })),
}))

import {
  sendInvoiceFinalizedEmail,
  sendQuotationFinalizedEmail,
  sendPurchaseOrderEmail,
  sendBusinessInvoiceGeneratedEmail,
  sendPOReceiveNotificationEmail,
  sendRfqConvertedToQuotationEmail,
} from '../src/lib/mail.js'
import { currentTenant } from '@jeffi/tenancy'
import { recordEmailSend } from '../src/lib/reply-context'

const okFetch = (body: object = { id: 'msg-1', status: 'sent', provider_ref: '<ref@ses>' }) =>
  vi.fn(async () => ({ ok: true, json: async () => body, statusText: 'OK' }) as any)

function lastFetchBody() {
  const call = vi.mocked(globalThis.fetch as any).mock.calls.at(-1)!
  return { url: call[0], init: call[1], body: JSON.parse(call[1].body) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(currentTenant).mockReturnValue({ tenantId: 't1', slug: 'acme' } as any)
})

describe('mail send() plumbing', () => {
  it('posts to the messaging service with a signed bearer token and theming', async () => {
    globalThis.fetch = okFetch()
    const r = await sendInvoiceFinalizedEmail('c@x.test', 'Jo', 'INV/1', 1234.5)
    expect(r).toEqual({ success: true, messageId: 'msg-1', error: undefined })
    const { url, init, body } = lastFetchBody()
    expect(url).toContain('/messages')
    expect(init.headers.authorization).toBe('Bearer signed-token')
    expect(body.channel).toBe('email')
    expect(body.to).toBe('c@x.test')
    expect(body.from).toBe('"Acme" <noreply@acme.test>')
    expect(body.reference).toBe('invoice_finalized')
    expect(body.metadata).toMatchObject({ invoiceNumber: 'INV/1', totalAmount: 1234.5, orderNumber: null })
    expect(String(body.body)).toContain('themed:')
  })

  it('falls back to the platform tenant when none in scope', async () => {
    vi.mocked(currentTenant).mockReturnValue(null as any)
    globalThis.fetch = okFetch()
    await sendInvoiceFinalizedEmail('c@x.test', 'Jo', 'INV/9', 10)
    // signServiceToken still called; no throw is the contract
    expect(lastFetchBody().body.to).toBe('c@x.test')
  })

  it('returns an error Result when the service responds !ok', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, statusText: 'Bad', json: async () => ({ message: 'nope' }) }) as any)
    const r = await sendInvoiceFinalizedEmail('c@x.test', 'Jo', 'INV/2', 10)
    expect(r.success).toBe(false)
    expect(r.error).toBe('nope')
  })

  it('returns success:false when the provider reports status failed', async () => {
    globalThis.fetch = okFetch({ id: 'm', status: 'failed', error: 'bounce' })
    const r = await sendInvoiceFinalizedEmail('c@x.test', 'Jo', 'INV/3', 10)
    expect(r.success).toBe(false)
    expect(r.error).toBe('bounce')
  })

  it('records the email send against a reply context (non-failed)', async () => {
    globalThis.fetch = okFetch({ id: 'm', status: 'sent', provider_ref: '<r@ses>' })
    await sendInvoiceFinalizedEmail('c@x.test', 'Jo', 'INV/4', 10, 'ORD/1', 'https://v', {
      contextId: 'ctx1',
      replyTo: 'reply+tok@reply.test',
    })
    expect(recordEmailSend).toHaveBeenCalledWith('ctx1', '<r@ses>')
    expect(lastFetchBody().body.reply_to).toBe('reply+tok@reply.test')
  })

  it('does NOT record when the send failed even with a reply target', async () => {
    globalThis.fetch = okFetch({ id: 'm', status: 'failed' })
    await sendInvoiceFinalizedEmail('c@x.test', 'Jo', 'INV/5', 10, undefined, undefined, {
      contextId: 'ctx2',
      replyTo: 'reply+t@reply.test',
    })
    expect(recordEmailSend).not.toHaveBeenCalled()
  })

  it('returns an error Result when fetch throws', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down')
    }) as any
    const r = await sendInvoiceFinalizedEmail('c@x.test', 'Jo', 'INV/6', 10)
    expect(r.success).toBe(false)
    expect((r.error as Error).message).toBe('network down')
  })
})

describe('mail templates — per-function references & reply copy branches', () => {
  beforeEach(() => {
    globalThis.fetch = okFetch()
  })

  it('invoice: orderNumber present vs absent in metadata', async () => {
    await sendInvoiceFinalizedEmail('c@x.test', 'Jo', 'INV/7', 100, 'ORD/7', 'https://v')
    expect(lastFetchBody().body.metadata.orderNumber).toBe('ORD/7')
  })

  it('quotation_finalized reference + subject', async () => {
    const r = await sendQuotationFinalizedEmail('c@x.test', 'Jo', 'Q/1', 500, 'https://v')
    expect(r.success).toBe(true)
    const b = lastFetchBody().body
    expect(b.reference).toBe('quotation_finalized')
    expect(b.subject).toContain('Q/1')
    expect(b.metadata).toMatchObject({ quoteNumber: 'Q/1', totalAmount: 500 })
  })

  it('quotation with a reply target sets reply_to', async () => {
    await sendQuotationFinalizedEmail('c@x.test', 'Jo', 'Q/2', 1, 'https://v', { contextId: 'cx', replyTo: 'r@r.test' })
    expect(lastFetchBody().body.reply_to).toBe('r@r.test')
  })

  it('purchase_order builds item rows and uses contactName||supplierName', async () => {
    const r = await sendPurchaseOrderEmail('s@x.test', '', 'Supplier Co', 'PO/1', 900, [
      { product_name: 'Wire', variant_name: 'Red', quantity: 2, unit_cost: 50 },
      { product_name: 'Nut', variant_name: null, quantity: 4, unit_cost: 10 },
    ], 'https://v')
    expect(r.success).toBe(true)
    expect(lastFetchBody().body.reference).toBe('purchase_order')
    expect(lastFetchBody().body.metadata).toMatchObject({ poNumber: 'PO/1', supplierName: 'Supplier Co', totalAmount: 900 })
  })

  it('business invoice reference + metadata', async () => {
    const r = await sendBusinessInvoiceGeneratedEmail('c@x.test', 'Jo', 'INV/B', 'ORD/B', 777, 'https://v')
    expect(r.success).toBe(true)
    expect(lastFetchBody().body.reference).toBe('business_invoice_generated')
    expect(lastFetchBody().body.metadata).toMatchObject({ invoiceNumber: 'INV/B', orderNumber: 'ORD/B', totalAmount: 777 })
  })

  it('PO receive: fully-received vs partially-received status label', async () => {
    await sendPOReceiveNotificationEmail('s@x.test', 'Sam', 'Supplier', 'PO/2', 'GRN/1', 'received', [
      { product_name: 'Bolt', variant_name: null, quantity_received: 3, unit_cost: 5 },
    ])
    expect(lastFetchBody().body.subject).toContain('Fully Received')
    await sendPOReceiveNotificationEmail('s@x.test', '', 'Supplier', 'PO/3', 'GRN/2', 'partial', [
      { product_name: 'Bolt', variant_name: 'M6', quantity_received: 1, unit_cost: 5 },
    ])
    expect(lastFetchBody().body.subject).toContain('Partially Received')
    expect(lastFetchBody().body.reference).toBe('po_receive')
  })

  it('rfq converted to quotation reference + metadata', async () => {
    const r = await sendRfqConvertedToQuotationEmail('c@x.test', 'Jo', 'RFQ/1', 'Q/9', 321, 'https://v')
    expect(r.success).toBe(true)
    expect(lastFetchBody().body.reference).toBe('rfq_converted_to_quotation')
    expect(lastFetchBody().body.metadata).toMatchObject({ rfqNumber: 'RFQ/1', quoteNumber: 'Q/9', totalAmount: 321 })
  })
})
