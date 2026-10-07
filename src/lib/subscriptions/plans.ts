import 'server-only'
import { queryOne } from '@/lib/shared/db'

export interface PlanKey {
  productId: string
  productName: string
  period: 'weekly' | 'monthly' | 'yearly'
  interval: number
  amountPaise: number
  collectingAccount: 'platform' | 'own'
}

/**
 * One Razorpay plan per (product, period, interval, per-cycle amount, collecting account). A
 * reprice simply keys a new plan; existing subscriptions keep theirs. A concurrent create may leave
 * one orphan plan on Razorpay — harmless, the cached row wins.
 */
export async function getOrCreatePlan(instance: any, key: PlanKey): Promise<string> {
  const params = [key.productId, key.period, key.interval, key.amountPaise, key.collectingAccount]
  const cached = await queryOne<{ razorpay_plan_id: string }>(
    `SELECT razorpay_plan_id FROM subscription_plans_cache
      WHERE product_id = $1 AND period = $2 AND interval_count = $3 AND amount_paise = $4 AND collecting_account = $5`,
    params
  )
  if (cached) return cached.razorpay_plan_id

  const plan = await instance.plans.create({
    period: key.period,
    interval: key.interval,
    item: { name: key.productName.slice(0, 100), amount: key.amountPaise, currency: 'INR' },
    notes: { product_id: key.productId },
  })

  const inserted = await queryOne<{ razorpay_plan_id: string }>(
    `INSERT INTO subscription_plans_cache (product_id, period, interval_count, amount_paise, collecting_account, razorpay_plan_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (product_id, period, interval_count, amount_paise, collecting_account) DO NOTHING
     RETURNING razorpay_plan_id`,
    [...params, plan.id]
  )
  if (inserted) return inserted.razorpay_plan_id
  const winner = await queryOne<{ razorpay_plan_id: string }>(
    `SELECT razorpay_plan_id FROM subscription_plans_cache
      WHERE product_id = $1 AND period = $2 AND interval_count = $3 AND amount_paise = $4 AND collecting_account = $5`,
    params
  )
  return winner?.razorpay_plan_id ?? plan.id
}
