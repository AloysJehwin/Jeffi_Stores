import Razorpay from 'razorpay'
import { getFeatureFlags } from '@/lib/site-controls'

export function getRazorpayInstance() {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    throw new Error('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set')
  }
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  })
}

export async function isRazorpayEnabled(): Promise<boolean> {
  return (await getFeatureFlags()).razorpayEnabled
}
