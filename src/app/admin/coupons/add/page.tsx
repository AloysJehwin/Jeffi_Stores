import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { query } from '@/lib/db'
import Link from 'next/link'
import CouponForm from '../CouponForm'

export const dynamic = 'force-dynamic'

async function createCoupon(formData: FormData) {
  'use server'
  const code = (formData.get('code') as string).toUpperCase().trim()
  const description = formData.get('description') as string
  const discount_type = formData.get('discount_type') as string
  const discount_value = parseFloat(formData.get('discount_value') as string)
  const min_purchase_amount = formData.get('min_purchase_amount') ? parseFloat(formData.get('min_purchase_amount') as string) : null
  const max_discount_amount = formData.get('max_discount_amount') ? parseFloat(formData.get('max_discount_amount') as string) : null
  const usage_limit = formData.get('usage_limit') ? parseInt(formData.get('usage_limit') as string, 10) : null
  const usage_limit_per_user = formData.get('usage_limit_per_user') ? parseInt(formData.get('usage_limit_per_user') as string, 10) : null
  const valid_from = formData.get('valid_from') || null
  const valid_until = formData.get('valid_until') || null
  const is_active = formData.get('is_active') === 'on'

  try {
    await query(
      `INSERT INTO coupons (code, description, discount_type, discount_value, min_purchase_amount, max_discount_amount, usage_limit, usage_limit_per_user, valid_from, valid_until, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [code, description || null, discount_type, discount_value, min_purchase_amount, max_discount_amount, usage_limit, usage_limit_per_user, valid_from, valid_until, is_active]
    )
  } catch (err) {
    if ((err as { digest?: string }).digest?.startsWith('NEXT_REDIRECT')) throw err
    throw new Error('Failed to create coupon — code may already exist')
  }
  revalidatePath('/admin/coupons')
  redirect('/admin/coupons')
}

export default function AddCouponPage() {
  return (
    <div className="p-4 sm:p-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin/coupons" className="text-foreground-muted hover:text-foreground transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-secondary-500 dark:text-foreground">Add Coupon</h1>
          <p className="text-sm text-foreground-secondary mt-0.5">Create a new discount coupon</p>
        </div>
      </div>

      <CouponForm action={createCoupon} submitLabel="Create Coupon" />
    </div>
  )
}
