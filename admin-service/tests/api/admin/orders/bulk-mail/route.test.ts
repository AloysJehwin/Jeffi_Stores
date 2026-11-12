import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/admin-audit', () => ({ logAdminAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/filters/entities/orders', () => ({ ORDERS_ENTITY: { key: 'orders' } }))
vi.mock('@jeffi/list-filters', () => ({ normalizeQuery: vi.fn((_e, sp: URLSearchParams) => Object.fromEntries(sp)) }))
vi.mock('@/lib/orders/customer-mail', () => ({ orderListMailTemplates: vi.fn() }))
vi.mock('@/lib/orders/bulk-mail', async () => {
  const actual = await vi.importActual<typeof import('@/lib/orders/bulk-mail')>('@/lib/orders/bulk-mail')
  return { ...actual, ordersForMail: vi.fn(), sendOrdersMail: vi.fn() }
})
// The real bulk-mail module is loaded for its constants and summary; keep its own imports inert.
vi.mock('@/lib/queries/shared', () => ({ queryMany: vi.fn(), entityOrderBy: vi.fn() }))
vi.mock('@/lib/email', () => ({ sendAdminContactEmail: vi.fn() }))
vi.mock('@/lib/replies/ask', () => ({ askAboutOrder: vi.fn() }))

import { GET, POST } from '@admin/app/api/(admin)/admin/orders/bulk-mail/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { logAdminAudit } from '@/lib/shared/admin-audit'
import { orderListMailTemplates } from '@/lib/orders/customer-mail'
import { ordersForMail, sendOrdersMail } from '@/lib/orders/bulk-mail'

const URL = 'http://localhost/api/admin/orders/bulk-mail?status=processing&sort=created&dir=asc'
const orders = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `o-${i}`, orderNumber: `ORD-${i}` }))
const post = (body: unknown, url = URL) =>
  POST(new NextRequest(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
const MAIL = { subject: 'Delay on {{order_number}}', body: '<p>Sorry</p>', isHtml: true, layout: 'message' }
const RESULT = { total: 2, sent: 2, noEmail: 0, missing: 0, failed: 0, notSent: [] }

describe('/api/admin/orders/bulk-mail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'super_admin', scopes: [] } as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(ordersForMail).mockResolvedValue({ orders: orders(2), capped: false })
    vi.mocked(sendOrdersMail).mockResolvedValue(RESULT)
    vi.mocked(orderListMailTemplates).mockResolvedValue([])
  })

  it('401 when not signed in; 403 without orders or without the mailer module', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValueOnce(null)
    expect((await post({ ...MAIL, count: 2 })).status).toBe(401)
    vi.mocked(hasScope).mockImplementation((_r, _s, scope) => scope !== 'orders:write')
    expect((await post({ ...MAIL, count: 2 })).status).toBe(403)
    vi.mocked(hasScope).mockImplementation((_r, _s, scope) => scope !== 'mailer:write')
    const res = await post({ ...MAIL, count: 2 })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/not included in your plan/)
    expect(sendOrdersMail).not.toHaveBeenCalled()
  })

  it('GET counts the orders the filters match and lists the templates', async () => {
    vi.mocked(orderListMailTemplates).mockResolvedValue([{ slug: 'order/delay-shipping' } as any])
    const res = await GET(new NextRequest(URL))
    expect(await res.json()).toEqual({ count: 2, capped: false, cap: 500, sample: { orderNumber: 'ORD-0' }, templates: [{ slug: 'order/delay-shipping' }] })
    // The list's own filters and sort, nothing else.
    expect(ordersForMail).toHaveBeenCalledWith({ status: 'processing', sort: 'created', dir: 'asc' }, { sort: 'created', dir: 'asc' })
  })

  it('emails exactly the orders the filters match and reports the outcome', async () => {
    const res = await post({ ...MAIL, count: 2 })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, done: true, sent: 2, summary: 'Emailed 2 of 2 orders.' })
    expect(sendOrdersMail).toHaveBeenCalledWith(orders(2), MAIL)
    expect(logAdminAudit).toHaveBeenCalledWith(
      expect.objectContaining({ adminId: 'a1', entityType: 'orders', summary: expect.stringContaining('Emailed 2 of 2 orders.') })
    )
  })

  it('refuses when the list no longer matches what the administrator was shown', async () => {
    const res = await post({ ...MAIL, count: 5 })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ count: 2 })
    expect(sendOrdersMail).not.toHaveBeenCalled()
  })

  it('refuses a list over the cap, and an empty one', async () => {
    vi.mocked(ordersForMail).mockResolvedValueOnce({ orders: orders(500), capped: true })
    expect((await post({ ...MAIL, count: 500 })).status).toBe(400)
    vi.mocked(ordersForMail).mockResolvedValueOnce({ orders: [], capped: false })
    expect((await post({ ...MAIL, count: 1 })).status).toBe(400)
    expect(sendOrdersMail).not.toHaveBeenCalled()
  })

  it('needs a subject, a message and the count', async () => {
    expect((await post({ subject: '', body: 'x', count: 2 })).status).toBe(400)
    expect((await post({ subject: 'x', body: 'y' })).status).toBe(400)
    expect(sendOrdersMail).not.toHaveBeenCalled()
  })

  it('answers at once for a long list and sends on after the response', async () => {
    vi.mocked(ordersForMail).mockResolvedValue({ orders: orders(21), capped: false })
    let finish: (r: typeof RESULT) => void = () => {}
    vi.mocked(sendOrdersMail).mockReturnValue(new Promise(r => (finish = r)))
    const res = await post({ ...MAIL, count: 21 })
    expect(await res.json()).toEqual({ success: true, done: false, total: 21 })
    expect(logAdminAudit).not.toHaveBeenCalled()
    finish({ ...RESULT, total: 21, sent: 21 })
    await vi.waitFor(() => expect(logAdminAudit).toHaveBeenCalled())
  })
})
