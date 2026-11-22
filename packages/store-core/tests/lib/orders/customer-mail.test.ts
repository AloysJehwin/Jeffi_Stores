import { describe, it, expect, vi, beforeEach } from 'vitest'

const db = vi.hoisted(() => ({ queryMany: vi.fn(async () => []), queryOne: vi.fn() }))
vi.mock('@/lib/shared/db', () => db)
vi.mock('@/lib/shared/customer-links', () => ({ orderUrl: vi.fn(async () => 'https://acme/orders/o1') }))
const vars = vi.hoisted(() => ({ resolveTemplateVariables: vi.fn(async (a: any) => ({ ...a.extra, email: a.recipient.email })) }))
vi.mock('@/lib/templates/variables', () => vars)
// findTokenKeys: pull {{token}} names out of a string
vi.mock('@/lib/templates/variables-shared', () => ({
  findTokenKeys: (s: string) => [...String(s).matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]),
}))
const lib = vi.hoisted(() => ({ listPageTemplates: vi.fn(async () => []) }))
vi.mock('@/lib/messaging/library', () => lib)
// Controlled placement fakes to drive scenario/fits/rank branches.
const scn = vi.hoisted(() => ({
  SCN_A: { id: 'a', label: 'A', reply: null, pickItem: false },
  SCN_PICK: { id: 'pick', label: 'Pick', reply: null, pickItem: true },
}))
vi.mock('@/lib/messaging/placements', () => ({
  PAGES: { order: { scenarios: [scn.SCN_A, scn.SCN_PICK] } },
  scenarioOf: (_page: string, tags: string[] | null) => (tags?.includes('scn:a') ? scn.SCN_A : tags?.includes('scn:pick') ? scn.SCN_PICK : null),
  scenarioFits: (s: any, o: any) => (s ? o.status === 'delivered' : true),
}))

import { orderMailTemplates, orderListMailTemplates, orderMailVars, unfilledTokens } from '@/lib/orders/customer-mail'
import { queryOne, queryMany } from '@/lib/shared/db'
import { resolveTemplateVariables } from '@/lib/templates/variables'
import { listPageTemplates } from '@/lib/messaging/library'

const tmpl = (over: Record<string, any> = {}) => ({
  slug: 't1',
  name: 'Tmpl',
  subject: 'S',
  preheader: 'P',
  body: 'B',
  layout: 'store',
  tags: [],
  ...over,
})

const orderRow = (over: Record<string, any> = {}) => ({
  id: 'o1',
  order_number: 'ORD-1',
  status: 'delivered',
  payment_status: 'paid',
  user_id: 'u1',
  created_at: '2026-05-01T00:00:00Z',
  total_amount: '1234.5',
  customer_name: 'Cara Lee',
  customer_email: 'c@acme.test',
  u_email: 'cara@acme.test',
  u_first: 'Cara',
  u_last: 'Lee',
  tracking_url: 'https://track/1',
  awb_number: 'AWB1',
  tracking_number: null,
  delhivery_shipment_id: null,
  edd: '2026-05-10T00:00:00Z',
  address: { full_name: 'Cara', address_line1: 'L1', city: 'Pune', state: 'MH', postal_code: '411001' },
  payment_link_url: 'https://pay/1',
  payment_link_status: 'created',
  refund: '100',
  ...over,
})

beforeEach(() => {
  vi.mocked(queryMany).mockResolvedValue([])
  vi.mocked(listPageTemplates).mockResolvedValue([] as any)
})

describe('orderMailTemplates', () => {
  it('returns null when the order is missing', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(null) // loadOrder
    vi.mocked(queryMany).mockResolvedValueOnce([]) // loadItems
    expect(await orderMailTemplates('o1')).toBeNull()
  })

  it('sorts fitting templates first and strips the rank field', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(orderRow({ status: 'delivered' }))
    vi.mocked(queryMany).mockResolvedValueOnce([{ id: 'i1', product_name: 'Widget', variant_name: 'Red', quantity: 2 }])
    vi.mocked(listPageTemplates).mockResolvedValueOnce([
      tmpl({ slug: 'no-scn', name: 'ZNoScenario', tags: [] }), // fits=true (no scenario)
      tmpl({ slug: 'scn-a', name: 'AScenario', tags: ['scn:a'] }), // fits=true (delivered)
    ] as any)
    const r = await orderMailTemplates('o1')
    expect(r).not.toBeNull()
    expect(r!.order).toEqual({ status: 'delivered', paymentStatus: 'paid', email: 'cara@acme.test' })
    expect(r!.items).toEqual([{ id: 'i1', name: 'Widget - Red', quantity: 2 }])
    // both fit; rank: scn-a (0) before no-scn (99)
    expect(r!.templates.map(t => t.slug)).toEqual(['scn-a', 'no-scn'])
    expect((r!.templates[0] as any).rank).toBeUndefined()
    expect(r!.templates[0].fits).toBe(true)
  })

  it('puts a non-fitting scenario template last', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(orderRow({ status: 'pending' })) // scenario won't fit
    vi.mocked(queryMany).mockResolvedValueOnce([])
    vi.mocked(listPageTemplates).mockResolvedValueOnce([
      tmpl({ slug: 'scn-a', name: 'AScenario', tags: ['scn:a'] }), // fits=false (pending)
      tmpl({ slug: 'no-scn', name: 'ZNoScenario', tags: [] }), // fits=true
    ] as any)
    const r = await orderMailTemplates('o1')
    expect(r!.templates.map(t => t.slug)).toEqual(['no-scn', 'scn-a'])
    expect(r!.templates[1].fits).toBe(false)
  })
})

describe('orderListMailTemplates', () => {
  it('drops pickItem templates and sorts the rest', async () => {
    vi.mocked(listPageTemplates).mockResolvedValueOnce([
      tmpl({ slug: 'pick', name: 'Pick', tags: ['scn:pick'] }), // pickItem -> excluded
      tmpl({ slug: 'scn-a', name: 'AScenario', tags: ['scn:a'] }),
      tmpl({ slug: 'plain', name: 'Plain', tags: [] }),
    ] as any)
    const r = await orderListMailTemplates()
    expect(r.map(t => t.slug)).toEqual(['scn-a', 'plain'])
    expect(r.every(t => t.fits)).toBe(true) // no order -> fits always true
  })
})

describe('orderMailVars', () => {
  it('returns null when the order is missing', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(null)
    vi.mocked(queryMany).mockResolvedValueOnce([])
    expect(await orderMailVars('o1')).toBeNull()
  })

  it('fills the order variables with formatted amounts and the created payment link', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(orderRow())
    vi.mocked(queryMany).mockResolvedValueOnce([{ id: 'i1', product_name: 'Widget', variant_name: 'Red', quantity: 2 }])
    const r = await orderMailVars('o1', { itemId: 'i1', usesPaymentLink: true })
    expect(r).not.toBeNull()
    expect(r!.orderNumber).toBe('ORD-1')
    expect(r!.recipient).toEqual({ email: 'cara@acme.test', first: 'Cara', last: 'Lee', name: 'Cara Lee' })
    const extra = vi.mocked(resolveTemplateVariables).mock.calls[0][0].extra!!
    expect(extra.order_number).toBe('ORD-1')
    expect(extra.total).toBe('1,234.50') // en-IN 2dp
    expect(extra.refund_amount).toBe('100.00')
    expect(extra.courier).toBe('Delhivery') // awb present
    expect(extra.awb).toBe('AWB1')
    expect(extra.item_name).toBe('Widget - Red')
    expect(extra.payment_url).toBe('https://pay/1') // created link reused
    expect(extra.delivery_address).toBe('Cara, L1, Pune, MH, 411001')
  })

  it('creates a payment link when asked and none is cached', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(orderRow({ payment_link_status: null, payment_link_url: null }))
    vi.mocked(queryMany).mockResolvedValueOnce([])
    vi.doMock('@/lib/payments/payment-link', () => ({ createOrderPaymentLink: vi.fn(async () => ({ paymentLinkUrl: 'https://pay/new' })) }))
    const r = await orderMailVars('o1', { usesPaymentLink: true, createPaymentLink: true })
    const extra = vi.mocked(resolveTemplateVariables).mock.calls[0][0].extra!
    expect(extra.payment_url).toBe('https://pay/new')
    expect(r!.orderNumber).toBe('ORD-1')
  })

  it('shows the placeholder when a link is needed but not created', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(orderRow({ payment_link_status: null, payment_link_url: null }))
    vi.mocked(queryMany).mockResolvedValueOnce([])
    await orderMailVars('o1', { usesPaymentLink: true, createPaymentLink: false })
    const extra = vi.mocked(resolveTemplateVariables).mock.calls[0][0].extra!
    expect(extra.payment_url).toBe('(a payment link is created when you send)')
  })

  it('leaves courier/awb empty when there is no shipment', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(orderRow({ awb_number: null, tracking_number: null, delhivery_shipment_id: null, address: null }))
    vi.mocked(queryMany).mockResolvedValueOnce([])
    await orderMailVars('o1')
    const extra = vi.mocked(resolveTemplateVariables).mock.calls[0][0].extra!
    expect(extra.courier).toBe('')
    expect(extra.awb).toBe('')
    expect(extra.delivery_address).toBe('')
  })

  it('derives first/last from customer_name when there is no user', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(orderRow({ u_first: null, u_last: null, u_email: null, customer_name: 'Deepa Rao', customer_email: 'deepa@acme.test' }))
    vi.mocked(queryMany).mockResolvedValueOnce([])
    const r = await orderMailVars('o1')
    expect(r!.recipient).toEqual({ email: 'deepa@acme.test', first: 'Deepa', last: 'Rao', name: 'Deepa Rao' })
  })

  it('sets courier to Delhivery from a shipment id even without an awb', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(orderRow({ awb_number: null, tracking_number: 'TRK9', delhivery_shipment_id: 'ship-1' }))
    vi.mocked(queryMany).mockResolvedValueOnce([])
    await orderMailVars('o1')
    const extra = vi.mocked(resolveTemplateVariables).mock.calls[0][0].extra!
    expect(extra.courier).toBe('Delhivery')
    expect(extra.awb).toBe('TRK9') // falls back to tracking_number
  })

  it('falls back to total_amount when there is no refund total', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(orderRow({ refund: null }))
    vi.mocked(queryMany).mockResolvedValueOnce([])
    await orderMailVars('o1')
    const extra = vi.mocked(resolveTemplateVariables).mock.calls[0][0].extra!
    expect(extra.refund_amount).toBe('1,234.50')
  })
})

describe('unfilledTokens', () => {
  it('reports tokens with no (trimmed) value, case-insensitively', () => {
    const out = unfilledTokens(['Hi {{first_name}}, order {{order_number}}, track {{tracking_url}}'], {
      first_name: 'Cara',
      ORDER_NUMBER: 'ORD-1', // case-insensitive match
      tracking_url: '   ', // whitespace -> unfilled
    })
    expect(out).toEqual(['tracking_url'])
  })

  it('dedupes across multiple texts', () => {
    const out = unfilledTokens(['{{a}} {{b}}', '{{a}} {{c}}'], { b: 'x' })
    expect(out.sort()).toEqual(['a', 'c'])
  })
})
