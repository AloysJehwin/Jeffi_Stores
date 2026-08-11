import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  queryOne: vi.fn(),
}))

vi.mock('@/lib/sms', () => ({
  sendOrderConfirmedSMS: vi.fn().mockResolvedValue(true),
  sendOrderShippedSMS: vi.fn().mockResolvedValue(true),
  sendOrderDeliveredSMS: vi.fn().mockResolvedValue(true),
  sendOrderCancelledSMS: vi.fn().mockResolvedValue(true),
  sendPaymentFailedSMS: vi.fn().mockResolvedValue(true),
  sendOutForDeliverySMS: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/lib/whatsapp', () => ({
  sendOrderConfirmedWhatsApp: vi.fn().mockResolvedValue(true),
  sendOrderShippedWhatsApp: vi.fn().mockResolvedValue(true),
  sendOrderDeliveredWhatsApp: vi.fn().mockResolvedValue(true),
  sendOrderCancelledWhatsApp: vi.fn().mockResolvedValue(true),
  sendPaymentFailedWhatsApp: vi.fn().mockResolvedValue(true),
  sendOutForDeliveryWhatsApp: vi.fn().mockResolvedValue(true),
}))

import {
  notifyOrderConfirmed, notifyOrderShipped, notifyOrderDelivered,
  notifyOrderCancelled, notifyOutForDelivery, notifyPaymentFailed,
} from '@/lib/notify'
import { queryOne } from '@/lib/db'
import * as sms from '@/lib/sms'
import * as wa from '@/lib/whatsapp'

const mockQueryOne = vi.mocked(queryOne)

// Let queued microtasks (the whatsapp .then→sms fallback) settle.
const flush = () => new Promise(r => setTimeout(r, 0))

function recipient(channel: string | null, phone: string | null = '9876543210') {
  return { phone, notification_channel: channel } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(Object.values(sms) as any[]).forEach(f => f.mockResolvedValue?.(true))
  ;(Object.values(wa) as any[]).forEach(f => f.mockResolvedValue?.(true))
})

describe('notifyOrderConfirmed', () => {
  it("channel 'sms' calls SMS sender only", async () => {
    mockQueryOne.mockResolvedValue(recipient('sms'))
    await notifyOrderConfirmed('u1', 'ORD1', 500)
    await flush()
    expect(sms.sendOrderConfirmedSMS).toHaveBeenCalledWith(expect.objectContaining({ orderNumber: 'ORD1', total: 500 }))
    expect(wa.sendOrderConfirmedWhatsApp).not.toHaveBeenCalled()
  })

  it("channel 'whatsapp' calls WhatsApp sender", async () => {
    mockQueryOne.mockResolvedValue(recipient('whatsapp'))
    await notifyOrderConfirmed('u1', 'ORD1', 500)
    await flush()
    expect(wa.sendOrderConfirmedWhatsApp).toHaveBeenCalled()
    expect(sms.sendOrderConfirmedSMS).not.toHaveBeenCalled()
  })

  it('falls back to SMS when WhatsApp returns false', async () => {
    mockQueryOne.mockResolvedValue(recipient('whatsapp'))
    vi.mocked(wa.sendOrderConfirmedWhatsApp).mockResolvedValue(false)
    await notifyOrderConfirmed('u1', 'ORD1', 500)
    await flush()
    expect(sms.sendOrderConfirmedSMS).toHaveBeenCalled()
  })

  it('falls back to SMS when WhatsApp rejects', async () => {
    mockQueryOne.mockResolvedValue(recipient('whatsapp'))
    vi.mocked(wa.sendOrderConfirmedWhatsApp).mockRejectedValue(new Error('x'))
    await notifyOrderConfirmed('u1', 'ORD1', 500)
    await flush()
    expect(sms.sendOrderConfirmedSMS).toHaveBeenCalled()
  })

  it("channel 'email' calls neither", async () => {
    mockQueryOne.mockResolvedValue(recipient('email'))
    await notifyOrderConfirmed('u1', 'ORD1', 500)
    await flush()
    expect(sms.sendOrderConfirmedSMS).not.toHaveBeenCalled()
    expect(wa.sendOrderConfirmedWhatsApp).not.toHaveBeenCalled()
  })

  it('null channel calls neither', async () => {
    mockQueryOne.mockResolvedValue(recipient(null))
    await notifyOrderConfirmed('u1', 'ORD1', 500)
    await flush()
    expect(sms.sendOrderConfirmedSMS).not.toHaveBeenCalled()
  })

  it('no phone calls neither', async () => {
    mockQueryOne.mockResolvedValue(recipient('sms', null))
    await notifyOrderConfirmed('u1', 'ORD1', 500)
    await flush()
    expect(sms.sendOrderConfirmedSMS).not.toHaveBeenCalled()
  })

  it('null recipient (no user) returns early', async () => {
    mockQueryOne.mockResolvedValue(null)
    await notifyOrderConfirmed(null, 'ORD1', 500)
    await flush()
    expect(sms.sendOrderConfirmedSMS).not.toHaveBeenCalled()
  })
})

describe('other notify fns route by channel', () => {
  it('notifyOrderShipped', async () => {
    mockQueryOne.mockResolvedValue(recipient('sms'))
    await notifyOrderShipped('u1', 'O', 'Delhivery', 'TRK')
    await flush()
    expect(sms.sendOrderShippedSMS).toHaveBeenCalledWith(expect.objectContaining({ courier: 'Delhivery', trackingId: 'TRK' }))
  })

  it('notifyOrderDelivered', async () => {
    mockQueryOne.mockResolvedValue(recipient('whatsapp'))
    await notifyOrderDelivered('u1', 'O')
    await flush()
    expect(wa.sendOrderDeliveredWhatsApp).toHaveBeenCalled()
  })

  it('notifyOrderCancelled', async () => {
    mockQueryOne.mockResolvedValue(recipient('sms'))
    await notifyOrderCancelled('u1', 'O')
    await flush()
    expect(sms.sendOrderCancelledSMS).toHaveBeenCalled()
  })

  it('notifyOutForDelivery', async () => {
    mockQueryOne.mockResolvedValue(recipient('whatsapp'))
    await notifyOutForDelivery('u1', 'O')
    await flush()
    expect(wa.sendOutForDeliveryWhatsApp).toHaveBeenCalled()
  })

  it('notifyPaymentFailed falls back to SMS when WA false', async () => {
    mockQueryOne.mockResolvedValue(recipient('whatsapp'))
    vi.mocked(wa.sendPaymentFailedWhatsApp).mockResolvedValue(false)
    await notifyPaymentFailed('u1', 'O')
    await flush()
    expect(sms.sendPaymentFailedSMS).toHaveBeenCalled()
  })

  it('swallows a rejected SMS send (sms channel .catch)', async () => {
    mockQueryOne.mockResolvedValue(recipient('sms'))
    vi.mocked(sms.sendOrderConfirmedSMS).mockRejectedValue(new Error('sms down'))
    await expect(notifyOrderConfirmed('u1', 'O', 1)).resolves.toBeUndefined()
    await flush()
  })

  it('each notify fn returns early for a null recipient', async () => {
    mockQueryOne.mockResolvedValue(null)
    await notifyOrderShipped('u1', 'O')
    await notifyOrderDelivered('u1', 'O')
    await notifyOrderCancelled('u1', 'O')
    await notifyOutForDelivery('u1', 'O')
    await notifyPaymentFailed('u1', 'O')
    await flush()
    expect(sms.sendOrderShippedSMS).not.toHaveBeenCalled()
    expect(sms.sendOrderDeliveredSMS).not.toHaveBeenCalled()
    expect(sms.sendOrderCancelledSMS).not.toHaveBeenCalled()
    expect(sms.sendOutForDeliverySMS).not.toHaveBeenCalled()
    expect(sms.sendPaymentFailedSMS).not.toHaveBeenCalled()
  })

  it('shipped/delivered/cancelled/outForDelivery all fall back to SMS when WA false', async () => {
    mockQueryOne.mockResolvedValue(recipient('whatsapp'))
    vi.mocked(wa.sendOrderShippedWhatsApp).mockResolvedValue(false)
    vi.mocked(wa.sendOrderDeliveredWhatsApp).mockResolvedValue(false)
    vi.mocked(wa.sendOrderCancelledWhatsApp).mockResolvedValue(false)
    vi.mocked(wa.sendOutForDeliveryWhatsApp).mockResolvedValue(false)
    await notifyOrderShipped('u1', 'O')
    await notifyOrderDelivered('u1', 'O')
    await notifyOrderCancelled('u1', 'O')
    await notifyOutForDelivery('u1', 'O')
    await flush()
    expect(sms.sendOrderShippedSMS).toHaveBeenCalled()
    expect(sms.sendOrderDeliveredSMS).toHaveBeenCalled()
    expect(sms.sendOrderCancelledSMS).toHaveBeenCalled()
    expect(sms.sendOutForDeliverySMS).toHaveBeenCalled()
  })
})
