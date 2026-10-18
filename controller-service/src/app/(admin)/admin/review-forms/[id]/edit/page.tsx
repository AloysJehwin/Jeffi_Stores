import { notFound, redirect } from 'next/navigation'
import { queryOne, queryMany } from '@/lib/shared/db'
import ReviewFormForm from '../../ReviewFormForm'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import MobileEditBlock from '@/components/admin/MobileEditBlock'
import { Badge, FormPage, PageHeader } from '@/components/admin/kit'
import { discardReviewFormDraft, resnapshotReviewFormSession } from './actions'

export const dynamic = 'force-dynamic'

interface ReviewForm {
  id: string
  title: string
  slug: string
  description: string | null
  template_type: 'google_review' | 'product_feedback' | 'testimonial'
  google_review_url: string
  coupon_id: string | null
  is_active: boolean
  is_draft: boolean
  custom_fields: { id: string; label: string; type: 'text' | 'textarea' | 'image' | 'rating'; required: boolean }[]
}
interface Coupon {
  id: string
  code: string
  description: string | null
}

export default async function EditReviewFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ [key: string]: string | undefined }>
}) {
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

  // Editing a live form ALWAYS goes through an edit-draft; the single entry is the
  // view page's Edit button (startReviewFormDraft). Hitting /edit directly on a live
  // form with no draft redirects to the view, matching products/coupons/suppliers.
  const draftRow = isCreateDraft
    ? null
    : await queryOne<{ form_id: string; fields: Record<string, unknown> }>(
        `SELECT form_id, fields FROM review_form_drafts WHERE form_id = $1`,
        [id]
      )
  if (!isCreateDraft && !draftRow) {
    redirect(ap(`/admin/review-forms/${id}/view${back ? `?back=${encodeURIComponent(backUrl)}` : ''}`, host))
  }

  const isDraft = !!draftRow
  const df = (draftRow?.fields || {}) as any

  return (
    <MobileEditBlock>
      <FormPage
        header={
          <PageHeader
            back={{ href: ap(backUrl, host), label: 'Review Forms' }}
            title={isCreateDraft ? 'Edit Draft Form' : isDraft ? 'Edit Draft' : 'Edit Review Form'}
            badges={(isDraft || isCreateDraft) && <Badge tone="amber">Draft</Badge>}
          />
        }
      >
        <ReviewFormForm
          isDraft={isDraft}
          isCreateDraft={isCreateDraft}
          coupons={coupons}
          formId={form.id}
          backUrl={backUrl}
          discardAction={isDraft ? discardReviewFormDraft.bind(null, id) : undefined}
          resnapshotAction={resnapshotReviewFormSession.bind(null, id)}
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
      </FormPage>
    </MobileEditBlock>
  )
}
