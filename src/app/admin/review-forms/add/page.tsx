import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { query, queryMany } from '@/lib/db'
import Link from 'next/link'
import ReviewFormForm from '../ReviewFormForm'

export const dynamic = 'force-dynamic'

interface Coupon { id: string; code: string; description: string | null; is_active: boolean }

async function createReviewForm(formData: FormData) {
  'use server'
  const title = (formData.get('title') as string).trim()
  const slug = (formData.get('slug') as string).toLowerCase().trim().replace(/[^a-z0-9-]/g, '-')
  const description = (formData.get('description') as string).trim() || null
  const google_review_url = (formData.get('google_review_url') as string).trim()
  const coupon_id = formData.get('coupon_id') || null
  const is_active = formData.get('is_active') === 'on'

  try {
    await query(
      `INSERT INTO review_forms (title, slug, description, google_review_url, coupon_id, is_active) VALUES ($1,$2,$3,$4,$5,$6)`,
      [title, slug, description, google_review_url, coupon_id, is_active]
    )
  } catch (err) {
    if ((err as { digest?: string }).digest?.startsWith('NEXT_REDIRECT')) throw err
    throw new Error('Failed to create form — slug may already be taken')
  }
  revalidatePath('/admin/review-forms')
  redirect('/admin/review-forms')
}

export default async function AddReviewFormPage() {
  const coupons = await queryMany<Coupon>('SELECT id, code, description, is_active FROM coupons WHERE is_active = true ORDER BY code')

  return (
    <div className="p-4 sm:p-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin/review-forms" className="text-foreground-muted hover:text-foreground transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-secondary-500 dark:text-foreground">Create Review Form</h1>
          <p className="text-sm text-foreground-secondary mt-0.5">Build a shareable form to collect Google reviews</p>
        </div>
      </div>

      <ReviewFormForm action={createReviewForm} submitLabel="Create Form" coupons={coupons} />
    </div>
  )
}
