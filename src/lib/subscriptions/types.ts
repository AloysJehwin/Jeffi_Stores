export class SubscriptionError extends Error {
  constructor(
    message: string,
    readonly status: number = 400
  ) {
    super(message)
    this.name = 'SubscriptionError'
  }
}

/** A `subscriptions` row (snake_case columns, pg types as returned). */
export interface SubscriptionRow {
  id: string
  user_id: string
  product_id: string
  status: string
  interval_minutes: number
  next_renewal_at: string | Date
  last_renewed_at: string | Date | null
  created_at: string | Date
  razorpay_subscription_id: string | null
  razorpay_plan_id: string | null
  variant_id: string | null
  sub_variant_id: string | null
  quantity: string | number
  interval: string | null
  interval_count: number | null
  period: string | null
  unit_price_paise: string | number | null
  unit_price_ex_gst: string | number | null
  shipping_paise: string | number | null
  gst_rate: string | number | null
  hsn_code: string | null
  is_digital: boolean | null
  address_id: string | null
  address_snapshot: Record<string, any> | null
  collecting_account: 'platform' | 'own' | string | null
  linked_account_id: string | null
  current_cycle: number | null
  current_start: string | Date | null
  current_end: string | Date | null
  access_expires_at: string | Date | null
  total_count: number | null
  min_cycles: number | null
  consent_version: string | null
  consent_at: string | Date | null
  cancel_at_cycle_end: boolean | null
  cancel_requested_at: string | Date | null
  paused_at: string | Date | null
  cancelled_at: string | Date | null
  locked_price_at: string | Date | null
  source: string | null
  updated_at: string | Date | null
}
