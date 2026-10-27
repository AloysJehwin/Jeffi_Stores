import { notFound } from 'next/navigation'
import Link from 'next/link'
import {
  Badge,
  Card,
  DetailHeader,
  EntityPage,
  Field,
  Fields,
  StatusBadge,
  ACTIVE_STATUS,
  badgeCls,
  ViewDraftLink,
} from '@/components/admin/kit'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { formsHostForHost } from '@/lib/tenant-registry'
import { queryOne } from '@/lib/shared/db'
import { heldDraftForView } from '@/lib/admin/draft-locks'
import { startReviewFormDraft } from './actions'

export const dynamic = 'force-dynamic'

interface ReviewForm {
  id: string
  title: string
  slug: string
  description: string | null
  template_type: 'google_review' | 'product_feedback' | 'testimonial'
  google_review_url: string | null
  coupon_id: string | null
  is_active: boolean
  is_draft: boolean
  custom_fields: { id: string; label: string; type: 'text' | 'textarea' | 'image' | 'rating'; required: boolean }[]
  submissions_count: number
  created_at: string
}

const TYPE_LABEL: Record<ReviewForm['template_type'], string> = {
  google_review: 'Google Review',
  product_feedback: 'Product Feedback',
  testimonial: 'Testimonial',
}

export default async function ReviewFormViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ back?: string }>
}) {
  const { id } = await params
  const { back } = await searchParams
  const host = await getHost()
  const backUrl = back && back.startsWith('/admin/review-forms') ? back : '/admin/review-forms'

  const form = await queryOne<ReviewForm & { coupon_code: string | null }>(
    `SELECT rf.*, c.code AS coupon_code
     FROM review_forms rf LEFT JOIN coupons c ON c.id = rf.coupon_id
     WHERE rf.id = $1`,
    [id]
  )
  if (!form) notFound()

  const [hasDraft, held] = await Promise.all([
    queryOne<{ form_id: string }>(`SELECT form_id FROM review_form_drafts WHERE form_id = $1`, [id]),
    heldDraftForView('review_form', id, `/admin/review-forms/${id}/edit`, backUrl),
  ])

  const formsBase = `https://${formsHostForHost(host)}`
  const publicUrl = `${formsBase}/${form.slug}`
  const customFields = Array.isArray(form.custom_fields) ? form.custom_fields : []

  const day = (d: string) =>
    new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <EntityPage
      header={
        <DetailHeader
          back={{ href: ap(backUrl, host), label: 'Review Forms' }}
          title={form.title}
          status={
            <>
              <StatusBadge status={String(form.is_active)} map={ACTIVE_STATUS} />
              {form.is_draft && <Badge tone="amber">Unpublished</Badge>}
              {hasDraft && <Badge tone="amber">Draft pending</Badge>}
              <span className={badgeCls('blue')}>{TYPE_LABEL[form.template_type]}</span>
            </>
          }
          subtitle={form.description || undefined}
          identifiers={[
            { label: 'Slug', value: form.slug, copy: true },
            { label: 'Created', value: day(form.created_at) },
          ]}
          actions={
            held ? (
              <ViewDraftLink held={held} />
            ) : form.is_draft || hasDraft ? (
              <Link
                href={ap(`/admin/review-forms/${id}/edit?back=${encodeURIComponent(backUrl)}`, host)}
                className="control-md bg-accent-500 font-semibold text-white hover:bg-accent-600"
              >
                {hasDraft ? 'Edit Draft' : 'Edit'}
              </Link>
            ) : (
              <form action={startReviewFormDraft.bind(null, id)}>
                <input type="hidden" name="_back" value={backUrl} />
                <button
                  type="submit"
                  className="control-md bg-accent-500 font-semibold text-white hover:bg-accent-600"
                >
                  Edit
                </button>
              </form>
            )
          }
        />
      }
      aside={
        <Card title="Details">
          <Fields cols={1}>
            <Field label="Template" value={TYPE_LABEL[form.template_type]} />
            <Field label="Coupon" value={form.coupon_code} mono />
            <Field
              label="Google URL"
              value={
                form.google_review_url ? (
                  <a href={form.google_review_url} target="_blank" rel="noopener noreferrer" className="text-accent-500 hover:underline">
                    Open
                  </a>
                ) : null
              }
            />
            <Field label="Submissions" value={String(form.submissions_count ?? 0)} />
            <Field
              label="Public link"
              value={
                <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="text-accent-500 hover:underline break-all">
                  {publicUrl}
                </a>
              }
            />
          </Fields>
        </Card>
      }
      main={
        <Card title="Questions" hint={`${customFields.length} field${customFields.length === 1 ? '' : 's'}`}>
          {customFields.length === 0 ? (
            <p className="text-sm text-foreground-muted">No custom questions.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {customFields.map((f, i) => (
                <li key={f.id} className="flex items-start justify-between gap-3 border-b border-border-default/60 pb-2 last:border-0 last:pb-0">
                  <div>
                    <p className="font-medium text-foreground">
                      <span className="text-foreground-muted">{i + 1}.</span> {f.label || <span className="italic text-foreground-muted">Untitled</span>}
                    </p>
                    <p className="text-xs text-foreground-muted capitalize">{f.type}</p>
                  </div>
                  {f.required && <span className={badgeCls('amber')}>Required</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      }
    />
  )
}
