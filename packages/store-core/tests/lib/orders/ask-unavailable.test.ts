import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))
const db = vi.hoisted(() => ({ queryOne: vi.fn() }))
vi.mock('@/lib/shared/db', () => db)
const mail = vi.hoisted(() => ({ sendAuditedMail: vi.fn(), mailShell: vi.fn(() => '<html>body</html>'), escapeHtml: (s: string) => s }))
vi.mock('@/lib/email/shared', () => mail)
const brand = vi.hoisted(() => ({ currentBrandNameAsync: vi.fn(async () => 'Acme'), customerMailFromAsync: vi.fn(async () => 'store@acme.test') }))
vi.mock('@/lib/catalog/brand', () => brand)
vi.mock('@/lib/shared/customer-links', () => ({ orderUrlById: vi.fn(async () => 'https://acme/orders/o1') }))
const ask = vi.hoisted(() => ({ askAboutOrder: vi.fn() }))
vi.mock('@/lib/replies/ask', () => ask)
const lib = vi.hoisted(() => ({ whatsappTemplateApproved: vi.fn(async () => false) }))
vi.mock('@/lib/messaging/library', () => lib)
const wa = vi.hoisted(() => ({ sendItemUnavailableWhatsApp: vi.fn(async () => true) }))
vi.mock('@/lib/shared/whatsapp', () => wa)

import { askAboutUnavailableItem } from '@/lib/orders/ask-unavailable'
import { queryOne } from '@/lib/shared/db'
import { sendAuditedMail } from '@/lib/email/shared'
import { askAboutOrder } from '@/lib/replies/ask'
import { whatsappTemplateApproved } from '@/lib/messaging/library'
import { sendItemUnavailableWhatsApp } from '@/lib/shared/whatsapp'

const row = (over: Record<string, any> = {}) => ({
  id: 'o1',
  order_number: 'ORD-1',
  status: 'pending',
  user_id: 'u1',
  email: 'c@acme.test',
  phone: '+919000000000',
  name: 'Cara',
  product_name: 'Widget',
  variant_name: 'Red',
  quantity: 2,
  ...over,
})

beforeEach(() => {
  vi.mocked(whatsappTemplateApproved).mockResolvedValue(false)
  vi.mocked(sendItemUnavailableWhatsApp).mockResolvedValue(true)
})

describe('askAboutUnavailableItem', () => {
  it('404 when the item is not found', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(null)
    const r = await askAboutUnavailableItem('o1', 'i1')
    expect(r).toEqual({ ok: false, error: 'Item not found', status: 404 })
    const [sql, params] = vi.mocked(queryOne).mock.calls[0]
    expect(sql).toContain('FROM orders o JOIN order_items oi')
    expect(params).toEqual(['o1', 'i1'])
  })

  it('400 when the order already shipped/closed', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(row({ status: 'shipped' }))
    const r = await askAboutUnavailableItem('o1', 'i1')
    expect(r).toEqual({ ok: false, error: 'This order has already shipped or closed', status: 400 })
  })

  it('400 when there is no email and no approved WhatsApp', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(row({ email: '', phone: '' }))
    const r = await askAboutUnavailableItem('o1', 'i1')
    expect(r).toEqual({ ok: false, error: 'No customer email or WhatsApp number for this order', status: 400 })
  })

  it('emails the customer and returns the email channel', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(row({ phone: '' }))
    // askAboutOrder invokes the send thunk and returns its settled results
    vi.mocked(askAboutOrder).mockImplementation(async (_scenario: any, _o: any, send: any) => send())
    vi.mocked(sendAuditedMail).mockResolvedValue(undefined as any)

    const r = await askAboutUnavailableItem('o1', 'i1')
    expect(r).toEqual({ ok: true, channels: ['email'] })

    const mailArg = vi.mocked(sendAuditedMail).mock.calls[0][0]
    expect(mailArg).toMatchObject({
      to: 'c@acme.test',
      from: 'store@acme.test',
      subject: 'An item in your order ORD-1 is unavailable',
      kind: 'order',
      templateName: 'order_item_unavailable',
      entityType: 'orders',
      entityId: 'o1',
      userId: 'u1',
    })
    expect(vi.mocked(askAboutOrder).mock.calls[0][0]).toBe('out_of_stock')
    expect(vi.mocked(askAboutOrder).mock.calls[0][1]).toBe('o1')
    expect(vi.mocked(askAboutOrder).mock.calls[0][3]).toEqual({ refId: 'i1' })
  })

  it('sends WhatsApp when approved and returns both channels', async () => {
    vi.mocked(whatsappTemplateApproved).mockResolvedValue(true)
    vi.mocked(queryOne).mockResolvedValueOnce(row())
    vi.mocked(askAboutOrder).mockImplementation(async (_s: any, _o: any, send: any) => send())
    vi.mocked(sendAuditedMail).mockResolvedValue(undefined as any)

    const r = await askAboutUnavailableItem('o1', 'i1')
    expect(r).toEqual({ ok: true, channels: ['email', 'whatsapp'] })
    expect(vi.mocked(sendItemUnavailableWhatsApp).mock.calls[0][0]).toMatchObject({
      phone: '+919000000000',
      orderNumber: 'ORD-1',
      item: 'Widget (Red) × 2',
    })
  })

  it('502 when every channel fails', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(row({ phone: '' }))
    vi.mocked(askAboutOrder).mockImplementation(async (_s: any, _o: any, send: any) => send())
    vi.mocked(sendAuditedMail).mockRejectedValue(new Error('smtp down'))

    const r = await askAboutUnavailableItem('o1', 'i1')
    expect(r).toEqual({ ok: false, error: 'smtp down', status: 502 })
  })

  it('502 with a WhatsApp send that returns false', async () => {
    vi.mocked(whatsappTemplateApproved).mockResolvedValue(true)
    vi.mocked(queryOne).mockResolvedValueOnce(row({ email: '' })) // only WA channel
    vi.mocked(sendItemUnavailableWhatsApp).mockResolvedValue(false)
    vi.mocked(askAboutOrder).mockImplementation(async (_s: any, _o: any, send: any) => send())

    const r = await askAboutUnavailableItem('o1', 'i1')
    expect(r).toEqual({ ok: false, error: 'WhatsApp not sent', status: 502 })
  })
})
