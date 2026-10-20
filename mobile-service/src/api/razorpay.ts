import { api } from './client'

export async function createRazorpayOrder(amount: number): Promise<{ id: string; currency: string; amount: number }> {
  return api('/api/razorpay/create-order', {
    method: 'POST',
    body: JSON.stringify({ amount }),
  })
}

export async function verifyPayment(payload: {
  razorpay_order_id: string
  razorpay_payment_id: string
  razorpay_signature: string
}): Promise<{ success: boolean }> {
  return api('/api/razorpay/verify', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
