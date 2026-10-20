import { api } from './client'

export interface RazorpayOrder {
  razorpayOrderId: string
  amount: number
  currency: string
  key_id: string
  draftToken?: string
  orderId?: string
}

/** Pass the checkout draftToken (new order) or an existing unpaid orderId (retry). */
export async function createRazorpayOrder(payload: { draftToken?: string; orderId?: string }): Promise<RazorpayOrder> {
  return api('/api/razorpay/create-order', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function verifyPayment(payload: {
  razorpay_order_id: string
  razorpay_payment_id: string
  razorpay_signature: string
  draftToken?: string
  orderId?: string
}): Promise<{ success: boolean; order?: { id: string; orderNumber: string; paymentStatus?: string } }> {
  return api('/api/razorpay/verify', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/** Whether a draft's Razorpay order was captured server-side (webhook) when verify could not confirm it. */
export async function checkPendingPayment(payload: {
  razorpayOrderId: string
  draftToken: string
}): Promise<{ order?: { id: string; orderNumber: string }; status?: string; error?: string }> {
  return api('/api/razorpay/check-pending', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
