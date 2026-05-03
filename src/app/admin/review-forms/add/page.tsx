import { queryMany } from '@/lib/db'
import Link from 'next/link'
import ReviewFormForm from '../ReviewFormForm'

export const dynamic = 'force-dynamic'

interface Coupon { id: string; code: string; description: string | null }

export default async function AddReviewFormPage() {
  const coupons = await queryMany<Coupon>('SELECT id, code, description FROM coupons WHERE is_active = true ORDER BY code')

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin/review-forms" className="text-foreground-muted hover:text-foreground transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-secondary-500 dark:text-foreground">Create Review Form</h1>
          <p className="text-sm text-foreground-secondary mt-0.5">Build a shareable form to collect Google reviews</p>
        </div>
      </div>

      <ReviewFormForm submitLabel="Create Form" coupons={coupons} />
    </div>
  )
}
