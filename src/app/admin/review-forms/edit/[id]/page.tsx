import { notFound } from 'next/navigation'
import { queryOne, queryMany, query } from '@/lib/db'
import Link from 'next/link'
import ReviewFormForm from '../../ReviewFormForm'
import { ap } from '@/lib/admin-path'
import { getHost } from '@/lib/get-host'

export const dynamic = 'force-dynamic'

interface ReviewForm {
  id: string; title: string; slug: string; description: string | null
  template_type: 'google_review' | 'product_feedback' | 'testimonial'
  google_review_url: string; coupon_id: string | null; is_active: boolean
  is_draft: boolean
  custom_fields: { id: string; label: string; type: 'text' | 'textarea' | 'image' | 'rating'; required: boolean }[]
}
interface Coupon { id: string; code: string; description: string | null }

export default async function EditReviewFormPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ [key: string]: string | undefined }> }) {
  const { id } = await params
  const resolvedSearchParams = await searchParams
  const host = await getHost()
  const back = resolvedSearchParams?.back
  const backUrl = back && back.startsWith('/admin/review-forms') ? back : '/admin/review-forms'

  const [form, coupons] = await Promise.all([
    queryOne<ReviewForm>('SELECT * FROM review_forms WHERE id = $1', [id]),
    queryMany<Coupon>('SELECT id, code, description FROM coupons WHERE is_active = true ORDER BY code'),
  ])
  if (!form) notFound()

  // Create-draft form (is_draft = true): edit the row in place — never seed a review_form_drafts
  // (edit-draft) row for it. Publish flips is_draft = false + is_active = true.
  const isCreateDraft = !!form.is_draft

  // Auto-create edit-draft on first edit visit (live forms only).
  let draftRow = isCreateDraft ? null : await queryOne<{ form_id: string; fields: Record<string, unknown> }>(
    `SELECT form_id, fields FROM review_form_drafts WHERE form_id = $1`, [id]
  )
  if (!isCreateDraft && !draftRow) {
    await query(
      `INSERT INTO review_form_drafts (form_id, fields)
       SELECT id, to_jsonb(rf) - 'id' - 'created_at' - 'updated_at' - 'submissions_count'
       FROM review_forms rf WHERE rf.id = $1
       ON CONFLICT (form_id) DO NOTHING`,
      [id]
    )
    draftRow = await queryOne<{ form_id: string; fields: Record<string, unknown> }>(
      `SELECT form_id, fields FROM review_form_drafts WHERE form_id = $1`, [id]
    )
  }

  const isDraft = !!draftRow
  const df = (draftRow?.fields || {}) as any

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center gap-3 mb-6">
        <Link href={ap(backUrl, host)} className="text-foreground-muted hover:text-foreground transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>
        </Link>
        <h1 className="text-2xl font-bold text-secondary-500 dark:text-foreground">{isCreateDraft ? 'Edit Draft Form' : isDraft ? 'Edit Draft' : 'Edit Review Form'}</h1>
      </div>

      {isCreateDraft && (
        <div className="mb-6 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-4 py-3">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">New form — draft</p>
          <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">This form is not on the live list yet. Save keeps it a draft; Publish makes it live.</p>
        </div>
      )}

      {isDraft && (
        <div className="mb-6 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Draft pending</p>
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">Changes are saved to draft. The live form stays unchanged until you publish.</p>
          </div>
          <form action={async () => {
            'use server'
            await query(`DELETE FROM review_form_drafts WHERE form_id = $1`, [id])
          }}>
            <button type="submit" className="text-xs text-amber-600 hover:underline ml-4">Discard draft</button>
          </form>
        </div>
      )}

      <ReviewFormForm
        isDraft={isDraft}
        isCreateDraft={isCreateDraft}
        coupons={coupons}
        formId={form.id}
        backUrl={backUrl}
        defaultValues={{
          title: df.title ?? form.title,
          slug: df.slug ?? form.slug,
          template_type: df.template_type ?? form.template_type ?? 'google_review',
          google_review_url: df.google_review_url ?? form.google_review_url,
          coupon_id: df.coupon_id ?? form.coupon_id,
          description: df.description ?? form.description,
          is_active: df.is_active ?? form.is_active,
          custom_fields: df.custom_fields ?? form.custom_fields ?? [],
        }}
      />
    </div>
  )
}
