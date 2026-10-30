import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/catalog/brand', () => ({
  storeMailTheme: vi.fn(async () => ({ accent: '#0f766e' })),
}))
vi.mock('@/lib/email', () => ({
  adminContactHtml: vi.fn(async (subject: string, body: string) => `<!DOCTYPE html><html><head></head><body><!--mail-brand--><b>Acme</b><!--/mail-brand--><h1>${subject}</h1>${body}</body></html>`),
}))
vi.mock('@/lib/orders/customer-mail', async () => {
  const actual = await vi.importActual<typeof import('@/lib/orders/customer-mail')>('@/lib/orders/customer-mail')
  return { unfilledTokens: actual.unfilledTokens, orderMailVars: vi.fn() }
})

import { POST } from '@controller/app/api/(admin)/admin/orders/[id]/send-customer-mail/preview/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { orderMailVars } from '@/lib/orders/customer-mail'

const params = Promise.resolve({ id: 'ord-1' })
const CTX = {
  vars: { customer_first_name: 'Alice', store_name: 'Acme', order_number: '1001', tracking_url: '' },
  recipient: { email: 'alice@example.com', first: 'Alice', last: 'Smith', name: 'Alice Smith' },
  orderNumber: '1001',
}
const req = (body: unknown) =>
  new NextRequest('http://localhost', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'super_admin', scopes: [] } as any)
  vi.mocked(hasScope).mockReturnValue(true)
  vi.mocked(orderMailVars).mockResolvedValue(CTX as any)
})

describe('POST /api/admin/orders/[id]/send-customer-mail/preview', () => {
  it('401 / 403 / 404', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValueOnce(null as any)
    expect((await POST(req({ subject: 'Hi', body: 'Hello' }), { params })).status).toBe(401)
    vi.mocked(hasScope).mockReturnValueOnce(false)
    expect((await POST(req({ subject: 'Hi', body: 'Hello' }), { params })).status).toBe(403)
    vi.mocked(orderMailVars).mockResolvedValueOnce(null)
    expect((await POST(req({ subject: 'Hi', body: 'Hello' }), { params })).status).toBe(404)
  })

  it('renders the order details through the store theme', async () => {
    const res = await POST(req({ subject: 'Order {{order_number}}', body: '<p>Hi {{customer_first_name}}</p>' }), { params })
    const json = await res.json()
    expect(json.subject).toBe('Order 1001')
    expect(json.html).toContain('<p>Hi Alice</p>')
    expect(json.html).not.toContain('<img')
    expect(json.html).toContain('#0f766e')
    expect(json.missing).toEqual([])
  })

  it('lists the unfilled tokens', async () => {
    const json = await (await POST(req({ subject: 'Hi', body: 'Track: {{tracking_url}} {{courier}}' }), { params })).json()
    expect(json.missing).toEqual(['tracking_url', 'courier'])
  })

  it('treats a malformed body as empty', async () => {
    expect((await POST(req('not-json'), { params })).status).toBe(200)
  })
})
