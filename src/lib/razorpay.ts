import Razorpay from 'razorpay'

let instance: InstanceType<typeof Razorpay> | null = null

export function getRazorpayInstance() {
  if (!instance) {
    instance = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID!,
      key_secret: process.env.RAZORPAY_KEY_SECRET!,
    })
  }
  return instance
}

export function isRazorpayEnabled(): boolean {
  return process.env.ENABLE_RAZORPAY === 'true'
}
