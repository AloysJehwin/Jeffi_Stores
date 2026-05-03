import { notFound } from 'next/navigation'
import { queryOne, queryMany } from '@/lib/db'
import Link from 'next/link'
import ReviewFormForm from '../../ReviewFormForm'

export const dynamic = 'force-dynamic'

interface ReviewForm {
  id: string; title: string; slug: string; description: string | null
  google_review_url: string; coupon_id: string | null; is_active: boolean
  custom_fields: { id: string; label: string; type: 'text' | 'textarea' | 'image' | 'rating'; required: boolean }[]
}
interface Coupon { id: string; code: string; description: string | null }

export default async function EditReviewFormPage({ params }: { params: { id: string } }) {
  const [form, coupons] = await Promise.all([
    queryOne<ReviewForm>('SELECT * FROM review_forms WHERE id = $1', [params.id]),
    queryMany<Coupon>('SELECT id, code, description FROM coupons WHERE is_active = true ORDER BY code'),
  ])
  if (!form) notFound()

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin/review-forms" className="text-foreground-muted hover:text-foreground transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>
        </Link>
        <h1 className="text-2xl font-bold text-secondary-500 dark:text-foreground">Edit Review Form</h1>
      </div>

      <ReviewFormForm
        submitLabel="Save Changes"
        coupons={coupons}
        formId={form.id}
        defaultValues={{
          title: form.title,
          slug: form.slug,
          google_review_url: form.google_review_url,
          coupon_id: form.coupon_id,
          description: form.description,
          is_active: form.is_active,
          custom_fields: form.custom_fields || [],
        }}
      />
    </div>
  )
}
