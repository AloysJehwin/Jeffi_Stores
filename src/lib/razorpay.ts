import Razorpay from 'razorpay'

export function getRazorpayInstance() {
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID!,
    key_secret: process.env.RAZORPAY_KEY_SECRET!,
  })
}

export function isRazorpayEnabled(): boolean {
  return process.env.ENABLE_RAZORPAY === 'true'
}
