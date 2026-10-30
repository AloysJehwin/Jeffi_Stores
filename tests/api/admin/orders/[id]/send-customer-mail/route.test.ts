import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/email', () => ({ sendAdminContactEmail: vi.fn() }))
vi.mock('@/lib/replies/ask', () => ({ askAboutOrder: vi.fn((_s, _o, send) => send()) }))
vi.mock('@/lib/orders/customer-mail', async () => {
  const actual = await vi.importActual<typeof import('@/lib/orders/customer-mail')>('@/lib/orders/customer-mail')
  return { unfilledTokens: actual.unfilledTokens, orderMailVars: vi.fn() }
})

import { POST } from '@admin/app/api/(admin)/admin/orders/[id]/send-customer-mail/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { sendAdminContactEmail } from '@/lib/email'
import { askAboutOrder } from '@/lib/replies/ask'
import { orderMailVars } from '@/lib/orders/customer-mail'

const ORDER_ID = 'order-uuid-1'
const PARAMS = { params: Promise.resolve({ id: ORDER_ID }) }
const ITEM = '7f0c1b9e-3f7a-4a51-9a5e-2d3c4b5a6f70'
const CTX = {
  vars: { customer_first_name: 'Alice', store_name: 'Acme', order_number: 'ORD-001', tracking_url: '', payment_url: 'https://rzp.io/x' },
  recipient: { email: 'alice@example.com', first: 'Alice', last: 'Smith', name: 'Alice Smith' },
  orderNumber: 'ORD-001',
}

const req = (body: unknown) =>
  new NextRequest(`http://localhost/api/admin/orders/${ORDER_ID}/send-customer-mail`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

describe('POST /api/admin/orders/[id]/send-customer-mail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'super_admin', scopes: [] } as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(orderMailVars).mockResolvedValue(CTX as any)
    vi.mocked(sendAdminContactEmail).mockResolvedValue({ success: true } as any)
  })

  it('401 when not signed in, 403 without the scopes', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValueOnce(null)
    expect((await POST(req({ subject: 'Hi', body: 'Hello' }), PARAMS)).status).toBe(401)
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await POST(req({ subject: 'Hi', body: 'Hello' }), PARAMS)).status).toBe(403)
  })

  it('400 on a bad body', async () => {
    expect((await POST(req('not-json'), PARAMS)).status).toBe(400)
    expect((await POST(req({ body: 'Hello' }), PARAMS)).status).toBe(400)
  })

  it('404 without the order, 400 without an email', async () => {
    vi.mocked(orderMailVars).mockResolvedValueOnce(null)
    expect((await POST(req({ subject: 'Hi', body: 'Hello' }), PARAMS)).status).toBe(404)
    vi.mocked(orderMailVars).mockResolvedValueOnce({ ...CTX, recipient: { ...CTX.recipient, email: '' } } as any)
    expect((await POST(req({ subject: 'Hi', body: 'Hello' }), PARAMS)).status).toBe(400)
  })

  it('fills the order details and sends', async () => {
    const res = await POST(req({ subject: 'Order {{order_number}}', body: '<p>Hi {{customer_first_name}}</p>', isHtml: true, layout: 'template' }), PARAMS)
    expect(res.status).toBe(200)
    const [to, , subject, body, opts] = vi.mocked(sendAdminContactEmail).mock.calls[0]
    expect(to).toBe('alice@example.com')
    expect(subject).toBe('Order ORD-001')
    expect(body).toBe('<p>Hi Alice</p>')
    expect(opts).toMatchObject({ layout: 'template', entityType: 'orders', entityId: ORDER_ID })
  })

  it('refuses to send with an unfilled token', async () => {
    const res = await POST(req({ subject: 'Hi', body: 'Track it: {{tracking_url}}' }), PARAMS)
    expect(res.status).toBe(422)
    expect((await res.json()).missing).toEqual(['tracking_url'])
    expect(sendAdminContactEmail).not.toHaveBeenCalled()
  })

  it('creates a payment link only for a real send that uses it', async () => {
    await POST(req({ subject: 'Pay', body: '<a href="{{payment_url}}">Pay</a>', isHtml: true }), PARAMS)
    expect(vi.mocked(orderMailVars).mock.calls.map(c => c[1]?.createPaymentLink)).toEqual([undefined, true])
  })

  it('sends a reply-read scenario inside its reply context', async () => {
    expect((await POST(req({ subject: 'Hi', body: 'Hello', scenario: 'out_of_stock' }), PARAMS)).status).toBe(400)
    await POST(req({ subject: 'Hi', body: 'Hello', scenario: 'out_of_stock', itemId: ITEM }), PARAMS)
    expect(askAboutOrder).toHaveBeenCalledWith('out_of_stock', ORDER_ID, expect.any(Function), { refId: ITEM })
    expect(sendAdminContactEmail).toHaveBeenCalledOnce()
  })

  it('500 when the send fails', async () => {
    vi.mocked(sendAdminContactEmail).mockResolvedValue({ success: false } as any)
    expect((await POST(req({ subject: 'Hi', body: 'Hello' }), PARAMS)).status).toBe(500)
  })
})
