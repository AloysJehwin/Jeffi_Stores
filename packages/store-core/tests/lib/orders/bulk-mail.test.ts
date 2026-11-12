import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))
const db = vi.hoisted(() => ({ queryMany: vi.fn(), entityOrderBy: vi.fn(() => 'ORDER BY o.created_at DESC') }))
vi.mock('@/lib/queries/shared', () => db)
vi.mock('@/lib/filters/entities/orders', () => ({ ORDERS_ENTITY: { key: 'orders', alias: 'o' } }))
const filters = vi.hoisted(() => ({ buildWhere: vi.fn(() => ({ where: "WHERE o.status = $1", params: ['processing'], nextIdx: 2 })) }))
vi.mock('@jeffi/list-filters', () => filters)
vi.mock('@/lib/email', () => ({ sendAdminContactEmail: vi.fn() }))
vi.mock('@/lib/replies/ask', () => ({ askAboutOrder: vi.fn((_s, _o, send) => send()) }))
vi.mock('@/lib/orders/customer-mail', async () => {
  const actual = await vi.importActual<typeof import('@/lib/orders/customer-mail')>('@/lib/orders/customer-mail')
  return { unfilledTokens: actual.unfilledTokens, orderMailVars: vi.fn() }
})

import { BULK_MAIL_CAP, bulkMailSummary, ordersForMail, sendOrdersMail } from '@/lib/orders/bulk-mail'
import { sendAdminContactEmail } from '@/lib/email'
import { askAboutOrder } from '@/lib/replies/ask'
import { orderMailVars } from '@/lib/orders/customer-mail'

const ctx = (n: string, over: Record<string, string> = {}, email = `${n}@example.com`) => ({
  vars: { customer_first_name: n, order_number: `ORD-${n}`, tracking_url: `https://track/${n}`, payment_url: '', ...over },
  recipient: { email, first: n, last: '', name: n },
  orderNumber: `ORD-${n}`,
})
const ORDERS = [
  { id: 'o-a', orderNumber: 'ORD-a' },
  { id: 'o-b', orderNumber: 'ORD-b' },
  { id: 'o-c', orderNumber: 'ORD-c' },
]
const MAIL = { subject: 'About {{order_number}}', body: '<p>Hi {{customer_first_name}}, track it at {{tracking_url}}</p>', isHtml: true }

describe('order list email', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(sendAdminContactEmail).mockResolvedValue({ success: true } as any)
    vi.mocked(orderMailVars).mockImplementation(async (id: string) => ctx(id.slice(2)) as any)
  })

  it('finds the orders the list filters match, in list order, and says when more than the cap match', async () => {
    db.queryMany.mockResolvedValue(Array.from({ length: 3 }, (_, i) => ({ id: `o-${i}`, order_number: `ORD-${i}` })))
    const out = await ordersForMail({ status: 'processing' } as any, { sort: 'created', dir: 'desc', cap: 2 })
    expect(out).toEqual({ orders: [{ id: 'o-0', orderNumber: 'ORD-0' }, { id: 'o-1', orderNumber: 'ORD-1' }], capped: true })
    const [sql, params] = db.queryMany.mock.calls[0]
    expect(sql).toContain('WHERE o.status = $1')
    expect(sql).toContain('ORDER BY o.created_at DESC')
    // One more than the cap is asked for, only to know whether more match.
    expect(params).toEqual(['processing', 3])
    expect(BULK_MAIL_CAP).toBe(500)
  })

  it('sends each order its own email, filled from that order', async () => {
    const out = await sendOrdersMail(ORDERS, MAIL)
    expect(out).toMatchObject({ total: 3, sent: 3, noEmail: 0, missing: 0, failed: 0, notSent: [] })
    const calls = vi.mocked(sendAdminContactEmail).mock.calls
    expect(calls.map(c => c[0]).sort()).toEqual(['a@example.com', 'b@example.com', 'c@example.com'])
    const toB = calls.find(c => c[0] === 'b@example.com')!
    expect(toB[2]).toBe('About ORD-b')
    expect(toB[3]).toContain('Hi b, track it at https://track/b')
    // Each email is logged against its own order.
    expect(toB[4]).toMatchObject({ entityType: 'orders', entityId: 'o-b', isHtml: true })
  })

  it('skips an order with nothing for a token rather than send it with a gap', async () => {
    vi.mocked(orderMailVars).mockImplementation(async (id: string) => ctx(id.slice(2), id === 'o-b' ? { tracking_url: '' } : {}) as any)
    const out = await sendOrdersMail(ORDERS, MAIL)
    expect(out).toMatchObject({ sent: 2, missing: 1 })
    expect(out.notSent).toEqual([{ orderNumber: 'ORD-b', reason: 'nothing for {{tracking_url}}' }])
    expect(vi.mocked(sendAdminContactEmail).mock.calls.map(c => c[0])).not.toContain('b@example.com')
  })

  it('skips an order with no customer email and carries on after a failed send', async () => {
    vi.mocked(orderMailVars).mockImplementation(async (id: string) => ctx(id.slice(2), {}, id === 'o-a' ? '' : `${id.slice(2)}@example.com`) as any)
    vi.mocked(sendAdminContactEmail).mockImplementation(async (to: string) => ({ success: to !== 'b@example.com' }) as any)
    const out = await sendOrdersMail(ORDERS, MAIL)
    expect(out).toMatchObject({ total: 3, sent: 1, noEmail: 1, failed: 1 })
    expect(bulkMailSummary(out)).toBe('Emailed 1 of 3 orders (1 without an email, 1 failed).')
  })

  it('counts an order whose lookup throws as failed and still emails the rest', async () => {
    vi.mocked(orderMailVars).mockImplementation(async (id: string) => {
      if (id === 'o-a') throw new Error('db down')
      return ctx(id.slice(2)) as any
    })
    const out = await sendOrdersMail(ORDERS, MAIL)
    expect(out).toMatchObject({ sent: 2, failed: 1 })
    expect(out.notSent[0]).toEqual({ orderNumber: 'ORD-a', reason: 'db down' })
  })

  it('creates a payment link only for an order that will actually be emailed', async () => {
    const mail = { subject: 'Pay for {{order_number}}', body: 'Pay here: {{payment_url}} or track {{tracking_url}}' }
    vi.mocked(orderMailVars).mockImplementation(async (id: string, opts: any = {}) =>
      ctx(id.slice(2), {
        payment_url: opts.createPaymentLink ? 'https://rzp.io/new' : '(a payment link is created when you send)',
        ...(id === 'o-b' ? { tracking_url: '' } : {}),
      }) as any
    )
    await sendOrdersMail(ORDERS.slice(0, 2), mail)
    const created = vi.mocked(orderMailVars).mock.calls.filter(c => (c[1] as any)?.createPaymentLink).map(c => c[0])
    expect(created).toEqual(['o-a']) // o-b has a gap, so nothing is created for it
    expect(vi.mocked(sendAdminContactEmail).mock.calls[0][3]).toContain('https://rzp.io/new')
  })

  it('sends a template whose reply is read with a reply address, per order', async () => {
    await sendOrdersMail(ORDERS.slice(0, 1), { ...MAIL, scenario: 'delay_shipping' })
    expect(askAboutOrder).toHaveBeenCalledWith('order_delay', 'o-a', expect.any(Function))
  })

  it('summarises a clean send', () => {
    expect(bulkMailSummary({ total: 1, sent: 1, noEmail: 0, missing: 0, failed: 0, notSent: [] })).toBe('Emailed 1 of 1 order.')
  })
})
