'use server'

import { redirect } from 'next/navigation'
import { ap } from '@/lib/admin-path'
import { getHost } from '@/lib/get-host'
import { revalidatePath } from 'next/cache'
import { query } from '@/lib/db'

export async function createCoupon(formData: FormData) {
  const code = (formData.get('code') as string).toUpperCase().trim()
  const description = formData.get('description') as string
  const discount_type = formData.get('discount_type') as string
  const discount_value = parseFloat(formData.get('discount_value') as string)
  const min_purchase_amount = formData.get('min_purchase_amount')
    ? parseFloat(formData.get('min_purchase_amount') as string)
    : null
  const max_discount_amount = formData.get('max_discount_amount')
    ? parseFloat(formData.get('max_discount_amount') as string)
    : null
  const usage_limit = formData.get('usage_limit') ? parseInt(formData.get('usage_limit') as string, 10) : null
  const usage_limit_per_user = formData.get('usage_limit_per_user')
    ? parseInt(formData.get('usage_limit_per_user') as string, 10)
    : null
  const valid_from = formData.get('valid_from') || null
  const valid_until = formData.get('valid_until') || null
  const is_active = formData.get('is_active') === 'true'
  const eligible_user_ids = formData.getAll('eligible_user_ids') as string[]

  // Create-as-draft: is_draft = true (and is_active = false) so the coupon lives ONLY in the
  // Drafts section, never the live list, and nothing can redeem it. "Publish" flips is_draft =
  // false + is_active = true to move it to the live list. A coupon that is merely deactivated
  // (is_draft = false, is_active = false) stays in the live list — distinct from a draft.
  let couponId: string
  try {
    const result = await query<{ id: string }>(
      `INSERT INTO coupons (code, description, discount_type, discount_value, min_purchase_amount, max_discount_amount, usage_limit, usage_limit_per_user, valid_from, valid_until, is_active, is_draft)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false,true) RETURNING id`,
      [
        code,
        description || null,
        discount_type,
        discount_value,
        min_purchase_amount,
        max_discount_amount,
        usage_limit,
        usage_limit_per_user,
        valid_from,
        valid_until,
      ]
    )
    couponId = result.rows[0].id
  } catch (err) {
    if ((err as { digest?: string }).digest?.startsWith('NEXT_REDIRECT')) throw err
    throw new Error('Failed to create coupon — code may already exist')
  }

  if (eligible_user_ids.length > 0) {
    for (const uid of eligible_user_ids) {
      await query(`INSERT INTO coupon_eligible_users (coupon_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [
        couponId,
        uid,
      ])
    }
  }

  revalidatePath('/admin/coupons')
  const host = await getHost()
  redirect(ap('/admin/coupons', host))
}
