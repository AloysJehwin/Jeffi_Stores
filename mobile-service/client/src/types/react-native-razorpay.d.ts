declare module 'react-native-razorpay' {
  export interface CheckoutOptions {
    key: string
    amount: number | string
    currency?: string
    name?: string
    description?: string
    image?: string
    order_id?: string
    prefill?: { email?: string; contact?: string; name?: string }
    notes?: Record<string, string>
    theme?: { color?: string }
    [key: string]: unknown
  }
  export interface SuccessResponse { razorpay_payment_id: string; razorpay_order_id?: string; razorpay_signature?: string }
  const RazorpayCheckout: { open(options: CheckoutOptions): Promise<SuccessResponse> }
  export default RazorpayCheckout
}
