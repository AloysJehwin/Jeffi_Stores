'use server'

import { redirect } from 'next/navigation'
import { ap } from '@/lib/admin-path'
import { getHost } from '@/lib/get-host'
import { revalidatePath } from 'next/cache'
import { query } from '@/lib/db'

export async function updateCoupon(id: string, formData: FormData) {
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
  const intent = formData.get('intent') as string | null
  const host = await getHost()
  const rawBack = formData.get('_back') as string | null
  // Save as Draft always returns to the list.
  const destination = rawBack && rawBack.startsWith('/admin/coupons') ? rawBack : '/admin/coupons'

  const draftFields = {
    code,
    description: description || null,
    discount_type,
    discount_value,
    min_purchase_amount,
    max_discount_amount,
    usage_limit,
    usage_limit_per_user,
    valid_from,
    valid_until,
    is_active,
  }

  try {
    if (intent === 'discard') {
      await query(`DELETE FROM coupon_drafts WHERE coupon_id = $1`, [id])
      revalidatePath(`/admin/coupons/edit/${id}`)
      redirect(ap(`/admin/coupons/edit/${id}`, host))
    }

    // Save to draft
    await query(
      `INSERT INTO coupon_drafts (coupon_id, fields, updated_at) VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (coupon_id) DO UPDATE SET fields = EXCLUDED.fields, updated_at = NOW()`,
      [id, JSON.stringify(draftFields)]
    )

    if (intent === 'publish') {
      // Publishing clears the draft flag and activates the coupon — a create-draft (is_draft=true)
      // moves out of the Drafts section onto the live list. is_active is forced true on publish;
      // the admin can deactivate afterwards from the live list.
      await query(
        `UPDATE coupons SET code=$1, description=$2, discount_type=$3, discount_value=$4,
         min_purchase_amount=$5, max_discount_amount=$6, usage_limit=$7, usage_limit_per_user=$8,
         valid_from=$9, valid_until=$10, is_active=true, is_draft=false WHERE id=$11`,
        [
          code,
          description || null,
          discount_type,
          isNaN(discount_value) ? 0 : discount_value,
          min_purchase_amount,
          max_discount_amount,
          usage_limit,
          usage_limit_per_user,
          valid_from,
          valid_until,
          id,
        ]
      )
      await query(`DELETE FROM coupon_drafts WHERE coupon_id = $1`, [id])
      revalidatePath('/admin/coupons')
      redirect(ap('/admin/coupons', host))
    }

    revalidatePath(`/admin/coupons/edit/${id}`)
    redirect(ap(destination, host))
  } catch (err: any) {
    if (err?.digest?.startsWith('NEXT_REDIRECT') || err?.type === 'NEXT_REDIRECT') throw err
    throw new Error(err?.message || 'Failed to update coupon')
  }
}
