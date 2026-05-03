import { redirect, notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { query, queryOne, queryMany } from '@/lib/db'
import Link from 'next/link'
import ReviewFormForm from '../../ReviewFormForm'

export const dynamic = 'force-dynamic'

interface ReviewForm {
  id: string; title: string; slug: string; description: string | null
  google_review_url: string; coupon_id: string | null; is_active: boolean
}
interface Coupon { id: string; code: string; description: string | null }

export default async function EditReviewFormPage({ params }: { params: { id: string } }) {
  const [form, coupons] = await Promise.all([
    queryOne<ReviewForm>('SELECT * FROM review_forms WHERE id = $1', [params.id]),
    queryMany<Coupon>('SELECT id, code, description FROM coupons WHERE is_active = true ORDER BY code'),
  ])
  if (!form) notFound()

  async function updateForm(formData: FormData) {
    'use server'
    const title = (formData.get('title') as string).trim()
    const slug = (formData.get('slug') as string).toLowerCase().trim().replace(/[^a-z0-9-]/g, '-')
    const description = (formData.get('description') as string).trim() || null
    const google_review_url = (formData.get('google_review_url') as string).trim()
    const coupon_id = formData.get('coupon_id') || null
    const is_active = formData.get('is_active') === 'on'

    try {
      await query(
        `UPDATE review_forms SET title=$1, slug=$2, description=$3, google_review_url=$4, coupon_id=$5, is_active=$6 WHERE id=$7`,
        [title, slug, description, google_review_url, coupon_id, is_active, params.id]
      )
    } catch (err) {
      if ((err as { digest?: string }).digest?.startsWith('NEXT_REDIRECT')) throw err
      throw new Error('Failed to update form')
    }
    revalidatePath('/admin/review-forms')
    redirect('/admin/review-forms')
  }

  return (
    <div className="p-4 sm:p-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin/review-forms" className="text-foreground-muted hover:text-foreground transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>
        </Link>
        <h1 className="text-2xl font-bold text-secondary-500 dark:text-foreground">Edit Review Form</h1>
      </div>

      <ReviewFormForm
        action={updateForm}
        submitLabel="Save Changes"
        coupons={coupons}
        defaultValues={{
          title: form.title,
          slug: form.slug,
          google_review_url: form.google_review_url,
          coupon_id: form.coupon_id,
          description: form.description,
          is_active: form.is_active,
        }}
      />
    </div>
  )
}
