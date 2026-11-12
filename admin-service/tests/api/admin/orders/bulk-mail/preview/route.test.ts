import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/email', () => ({ adminContactHtml: vi.fn(async (_s: string, body: string) => `<html>${body}</html>`) }))
vi.mock('@/lib/shared/mail-template', () => ({ applyMailTheme: vi.fn((html: string) => html) }))
vi.mock('@/lib/catalog/brand', () => ({ storeMailTheme: vi.fn(async () => ({})) }))
vi.mock('@/lib/filters/entities/orders', () => ({ ORDERS_ENTITY: { key: 'orders' } }))
vi.mock('@jeffi/list-filters', () => ({ normalizeQuery: vi.fn((_e, sp: URLSearchParams) => Object.fromEntries(sp)) }))
vi.mock('@/lib/orders/bulk-mail', () => ({ ordersForMail: vi.fn() }))
vi.mock('@/lib/orders/customer-mail', async () => {
  const actual = await vi.importActual<typeof import('@/lib/orders/customer-mail')>('@/lib/orders/customer-mail')
  return { unfilledTokens: actual.unfilledTokens, orderMailVars: vi.fn() }
})

import { POST } from '@admin/app/api/(admin)/admin/orders/bulk-mail/preview/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { ordersForMail } from '@/lib/orders/bulk-mail'
import { orderMailVars } from '@/lib/orders/customer-mail'

const post = (body: unknown) =>
  POST(
    new NextRequest('http://localhost/api/admin/orders/bulk-mail/preview?status=processing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  )

describe('POST /api/admin/orders/bulk-mail/preview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'super_admin', scopes: [] } as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(ordersForMail).mockResolvedValue({ orders: [{ id: 'o-1', orderNumber: 'ORD-1' }], capped: true })
    vi.mocked(orderMailVars).mockResolvedValue({
      vars: { customer_first_name: 'Alice', order_number: 'ORD-1', tracking_url: '' },
      recipient: { email: 'alice@example.com', first: 'Alice', last: '', name: 'Alice' },
      orderNumber: 'ORD-1',
    } as any)
  })

  it('401 when not signed in, 403 without the mailer module', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValueOnce(null)
    expect((await post({ subject: 's', body: 'b' })).status).toBe(401)
    vi.mocked(hasScope).mockImplementation((_r, _s, scope) => scope !== 'mailer:write')
    expect((await post({ subject: 's', body: 'b' })).status).toBe(403)
  })

  it('renders the email with the list’s first order and names the tokens it has nothing for', async () => {
    const res = await post({ subject: 'About {{order_number}}', body: '<p>Hi {{customer_first_name}}, {{tracking_url}}</p>' })
    const d = await res.json()
    expect(ordersForMail).toHaveBeenCalledWith({ status: 'processing' }, expect.objectContaining({ cap: 1 }))
    expect(orderMailVars).toHaveBeenCalledWith('o-1', { usesPaymentLink: false })
    expect(d.subject).toBe('About ORD-1')
    expect(d.html).toContain('Hi Alice')
    expect(d.missing).toEqual(['tracking_url'])
    expect(d.sample).toEqual({ orderNumber: 'ORD-1' })
  })

  it('404 when no order matches the filters', async () => {
    vi.mocked(ordersForMail).mockResolvedValue({ orders: [], capped: false })
    expect((await post({ subject: 's', body: 'b' })).status).toBe(404)
  })
})
