import { redirect, notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { query, queryOne } from '@/lib/db'
import Link from 'next/link'
import CouponForm from '../../CouponForm'

export const dynamic = 'force-dynamic'

interface Coupon {
  id: string
  code: string
  description: string | null
  discount_type: string
  discount_value: number
  min_purchase_amount: number | null
  max_discount_amount: number | null
  usage_limit: number | null
  usage_limit_per_user: number | null
  valid_from: string | null
  valid_until: string | null
  is_active: boolean
}

function toDatetimeLocal(val: string | null) {
  if (!val) return ''
  return new Date(val).toISOString().slice(0, 16)
}

export default async function EditCouponPage({ params }: { params: { id: string } }) {
  const coupon = await queryOne<Coupon>('SELECT * FROM coupons WHERE id = $1', [params.id])
  if (!coupon) notFound()

  async function updateCoupon(formData: FormData) {
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
        `UPDATE coupons SET code=$1, description=$2, discount_type=$3, discount_value=$4, min_purchase_amount=$5, max_discount_amount=$6, usage_limit=$7, usage_limit_per_user=$8, valid_from=$9, valid_until=$10, is_active=$11 WHERE id=$12`,
        [code, description || null, discount_type, discount_value, min_purchase_amount, max_discount_amount, usage_limit, usage_limit_per_user, valid_from, valid_until, is_active, params.id]
      )
    } catch (err) {
      if ((err as { digest?: string }).digest?.startsWith('NEXT_REDIRECT')) throw err
      throw new Error('Failed to update coupon')
    }
    revalidatePath('/admin/coupons')
    redirect('/admin/coupons')
  }

  return (
    <div className="p-4 sm:p-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin/coupons" className="text-foreground-muted hover:text-foreground transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-secondary-500 dark:text-foreground">Edit Coupon</h1>
          <p className="text-sm text-foreground-secondary mt-0.5 font-mono">{coupon.code}</p>
        </div>
      </div>

      <CouponForm
        action={updateCoupon}
        submitLabel="Save Changes"
        defaultValues={{
          code: coupon.code,
          discount_type: coupon.discount_type,
          discount_value: coupon.discount_value,
          min_purchase_amount: coupon.min_purchase_amount,
          max_discount_amount: coupon.max_discount_amount,
          usage_limit: coupon.usage_limit,
          usage_limit_per_user: coupon.usage_limit_per_user,
          valid_from: toDatetimeLocal(coupon.valid_from),
          valid_until: toDatetimeLocal(coupon.valid_until),
          description: coupon.description,
          is_active: coupon.is_active,
        }}
      />
    </div>
  )
}
