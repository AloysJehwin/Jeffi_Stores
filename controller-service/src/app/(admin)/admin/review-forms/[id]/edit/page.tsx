import { notFound, redirect } from 'next/navigation'
import { queryOne, queryMany } from '@/lib/shared/db'
import ReviewFormForm from '../../ReviewFormForm'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import MobileEditBlock from '@/components/admin/MobileEditBlock'
import { Badge, FormPage, PageHeader } from '@/components/admin/kit'
import { discardReviewFormDraft, resnapshotReviewFormSession } from './actions'
import { initialDraftLock } from '@/lib/admin/draft-locks'
import { getAdminSession } from '@/lib/auth/admin-auth'
import { draftBehind, draftsOf, getDraftRow } from '@/lib/admin/draft-branches'
import { reviewFormDrafts } from '@/lib/catalog/review-form-draft'
import DraftBehindBanner from '@/components/admin/drafts/DraftBehindBanner'

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

  // Editing a live form ALWAYS goes through an edit-draft (?draft=<id>). Without one, open the
  // admin's own draft; otherwise the view page lists the open drafts and starts a new one.
  let draftRow = isCreateDraft || !resolvedSearchParams.draft ? null : await getDraftRow(reviewFormDrafts, resolvedSearchParams.draft)
  if (draftRow && draftRow.form_id !== id) draftRow = null
  if (!isCreateDraft && !draftRow) {
    const session = await getAdminSession()
    const mine = session ? (await draftsOf(reviewFormDrafts, id)).find(d => d.authorId === session.adminId) : null
    const qs = new URLSearchParams({ ...(back ? { back } : {}), ...(mine ? { draft: mine.id } : {}) }).toString()
    redirect(ap(mine ? `/admin/review-forms/${id}/edit?${qs}` : `/admin/review-forms/${id}/view${back ? `?back=${encodeURIComponent(backUrl)}` : ''}`, host))
  }

  const isDraft = !!draftRow
  const df = (draftRow?.fields || {}) as any
  const lockId = isDraft ? (draftRow!.id as string) : id
  const [behind, siblings] = isDraft
    ? await Promise.all([draftBehind(reviewFormDrafts, lockId), draftsOf(reviewFormDrafts, id).then(d => d.length - 1)])
    : [null, 0]

  const initialLock = await initialDraftLock('review_form', lockId)

  return (
    <MobileEditBlock>
      <FormPage
        header={
          <PageHeader
            back={{ href: ap(backUrl, host), label: 'Review Forms' }}
            title={isCreateDraft ? 'Edit Draft Form' : isDraft ? (draftRow!.title ? `Edit Draft · ${draftRow!.title}` : 'Edit Draft') : 'Edit Review Form'}
            badges={(isDraft || isCreateDraft) && <Badge tone="amber">Draft</Badge>}
          />
        }
      >
        {isDraft && <DraftBehindBanner info={behind} siblings={siblings} noun="review form" />}
        <ReviewFormForm
          initialLock={initialLock}
          draftId={isDraft ? lockId : null}
          isDraft={isDraft}
          isCreateDraft={isCreateDraft}
          coupons={coupons}
          formId={form.id}
          backUrl={backUrl}
          discardAction={isDraft ? discardReviewFormDraft.bind(null, id, lockId) : undefined}
          resnapshotAction={resnapshotReviewFormSession.bind(null, lockId)}
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
