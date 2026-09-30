import { Suspense } from 'react'
import Link from 'next/link'
import { queryMany, queryCount } from '@/lib/db'
import AdminFilters from '@/components/admin/AdminFilters'
import Pagination from '@/components/admin/Pagination'
import DeleteReviewFormButton from '@/components/admin/DeleteReviewFormButton'
import CopyLinkButton from '@/components/admin/CopyLinkButton'
import DraftRowActions from '@/components/admin/DraftRowActions'
import ReviewFormTableRow from '@/components/admin/ReviewFormTableRow'
import { ap } from '@/lib/admin-path'
import { getHost } from '@/lib/get-host'
import { formsHostForHost } from '@/lib/tenant-registry'
import AdminTableSkeleton from '@/components/admin/AdminTableSkeleton'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const PAGE_SIZE = 25

async function getForms(filters: { search?: string; page?: number }) {
  const conditions: string[] = []
  const params: unknown[] = []
  let i = 1

  // Never-published drafts live only in the Drafts section, never the live list.
  conditions.push(`rf.is_draft = false`)

  if (filters.search) {
    conditions.push(`(rf.title ILIKE $${i} OR rf.slug ILIKE $${i})`)
    params.push(`%${filters.search}%`)
    i++
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = PAGE_SIZE
  const offset = ((filters.page || 1) - 1) * limit

  const [forms, total] = await Promise.all([
    queryMany(
      `SELECT rf.*, c.code AS coupon_code FROM review_forms rf LEFT JOIN coupons c ON rf.coupon_id = c.id ${where} ORDER BY rf.created_at DESC LIMIT $${i} OFFSET $${i + 1}`,
      [...params, limit, offset]
    ),
    queryCount(`SELECT COUNT(*) FROM review_forms rf ${where}`, params),
  ])

  return { forms, total }
}

export default async function ReviewFormsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>
}) {
  const host = await getHost()

  return (
    <div className="p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Review Forms</h1>
          <p className="text-foreground-secondary mt-1 text-sm">
            Shareable forms that reward customers for Google reviews
          </p>
        </div>
        <div className="hidden md:block">
          <Link
            href={ap('/admin/review-forms/add', host)}
            className="bg-accent-500 hover:bg-accent-600 text-white px-5 py-2.5 rounded-lg font-semibold transition-colors text-center text-sm sm:text-base"
          >
            Create Form
          </Link>
        </div>
      </div>

      <AdminFilters filters={[]} searchPlaceholder="Search by title or slug..." suggestType="review_forms" />

      <Suspense fallback={null}>
        <ReviewFormsDraftsBanner host={host} />
      </Suspense>

      <ReviewFormsListSection searchParams={searchParams} host={host} />
    </div>
  )
}

async function ReviewFormsDraftsBanner({ host }: { host: string }) {
  const [pendingDrafts, createDrafts] = await Promise.all([
    // Edit-drafts: unpublished CHANGES staged against a live form (review_form_drafts).
    queryMany<{ form_id: string; name: string; updated_at: string }>(
      `SELECT rfd.form_id, rf.title AS name, rfd.updated_at
       FROM review_form_drafts rfd
       JOIN review_forms rf ON rf.id = rfd.form_id
       ORDER BY rfd.updated_at DESC
       LIMIT 20`
    ),
    // Create-drafts: brand-new forms never published to the live list (is_draft = true).
    queryMany<{ id: string; title: string; created_at: string }>(
      `SELECT id, title, created_at FROM review_forms WHERE is_draft = true ORDER BY created_at DESC LIMIT 20`
    ),
  ])

  const pendingDraftsCount = pendingDrafts.length + createDrafts.length
  if (pendingDraftsCount === 0) return null

  return (
    <details className="mb-6 group">
      <summary className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-lg cursor-pointer list-none flex items-center justify-between px-4 py-2.5 group-open:rounded-b-none">
        <span className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
          <svg
            className="w-4 h-4 transition-transform group-open:rotate-90"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          Pending Drafts ({pendingDraftsCount})
        </span>
        <span className="text-xs text-amber-600 dark:text-amber-400">Not yet published to the live list</span>
      </summary>
      <div className="bg-amber-50 dark:bg-amber-900/20 border border-t-0 border-amber-300 dark:border-amber-700 rounded-b-lg overflow-hidden">
        <div className="divide-y divide-amber-100 dark:divide-amber-800/30">
          {/* Create-drafts: brand-new forms not yet on the live list. Publish activates them. */}
          {createDrafts.map(d => (
            <DraftRowActions
              key={`new-${d.id}`}
              entityId={d.id}
              name={d.title}
              subtitle="New form — not yet published"
              updatedAt={d.created_at}
              editHref={ap(`/admin/review-forms/edit/${d.id}`, host)}
              publishPath={`/api/admin/review-forms/${d.id}`}
              publishMethod="PATCH"
              publishBody={{ is_draft: false, is_active: true }}
              publishConfirm={`Publish "${d.title}" to the live form list?`}
              discardPath={`/api/admin/review-forms/${d.id}`}
              discardConfirm={`Delete the draft form "${d.title}"? This cannot be undone.`}
              entityLabel="review form"
            />
          ))}
          {pendingDrafts.map(d => (
            <DraftRowActions
              key={d.form_id}
              entityId={d.form_id}
              name={d.name}
              updatedAt={d.updated_at}
              editHref={ap(`/admin/review-forms/edit/${d.form_id}`, host)}
              publishPath={`/api/admin/review-forms/${d.form_id}/publish`}
              discardPath={`/api/admin/review-forms/${d.form_id}/draft`}
              entityLabel="review form"
            />
          ))}
        </div>
      </div>
    </details>
  )
}

async function ReviewFormsListSection({
  searchParams,
  host,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>
  host: string
}) {
  const resolvedSearchParams = await searchParams
  const key = JSON.stringify(resolvedSearchParams)

  return (
    <Suspense key={key} fallback={<AdminTableSkeleton rows={8} cols={7} />}>
      <ReviewFormsListContent resolvedSearchParams={resolvedSearchParams} host={host} />
    </Suspense>
  )
}

async function ReviewFormsListContent({
  resolvedSearchParams,
  host,
}: {
  resolvedSearchParams: { [key: string]: string | undefined }
  host: string
}) {
  const page = Math.max(1, parseInt(resolvedSearchParams.page || '1', 10))
  const { forms, total } = await getForms({ search: resolvedSearchParams.search, page })
  const formsBase = `https://${formsHostForHost(host)}`

  const buildUrl = (p: number) => {
    const params = new URLSearchParams()
    if (resolvedSearchParams.search) params.set('search', resolvedSearchParams.search)
    if (p > 1) params.set('page', String(p))
    const qs = params.toString()
    return ap(`/admin/review-forms${qs ? `?${qs}` : ''}`, host)
  }

  const currentListUrl = (() => {
    const params = new URLSearchParams()
    if (resolvedSearchParams.search) params.set('search', resolvedSearchParams.search)
    if (page > 1) params.set('page', String(page))
    const qs = params.toString()
    return `/admin/review-forms${qs ? `?${qs}` : ''}`
  })()

  return (
    <>
      <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default overflow-hidden mt-4">
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-secondary">
              <tr>
                {['Title', 'Template', 'Shareable Link', 'Coupon', 'Submissions', 'Status', 'Actions'].map(h => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-semibold text-foreground-secondary uppercase tracking-wider"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              {(forms as FormRow[]).map(f => (
                <ReviewFormTableRow key={f.id} form={f} backUrl={currentListUrl} formsBase={formsBase} />
              ))}
              {forms.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-foreground-muted">
                    No review forms yet. Create your first one!
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="md:hidden divide-y divide-border-default">
          {(forms as FormRow[]).map(f => {
            const formUrl = `${formsBase}/${f.slug}`
            return (
              <div key={f.id} className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground">{f.title}</span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${f.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}
                  >
                    {f.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <CopyLinkButton url={formUrl} />
                <p className="text-xs text-foreground-muted">
                  Coupon: {f.coupon_code || 'None'} · {f.submissions_count} submissions
                </p>
                <div className="flex gap-3 pt-1">
                  <a
                    href={formUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-foreground-muted hover:underline"
                  >
                    Open ↗
                  </a>
                  <Link
                    href={ap(`/admin/review-forms/${f.id}/submissions`, host)}
                    className="text-xs text-accent-500 hover:underline"
                  >
                    Submissions
                  </Link>
                  <div className="hidden md:flex gap-3">
                    <Link
                      href={ap(`/admin/review-forms/edit/${f.id}?back=${encodeURIComponent(currentListUrl)}`, host)}
                      className="text-xs text-accent-500 hover:underline"
                    >
                      Edit
                    </Link>
                    <DeleteReviewFormButton id={f.id} title={f.title} />
                  </div>
                </div>
              </div>
            )
          })}
          {forms.length === 0 && <p className="p-6 text-center text-foreground-muted text-sm">No review forms yet.</p>}
        </div>
      </div>

      <Pagination page={page} total={total} pageSize={PAGE_SIZE} buildUrl={buildUrl} />
    </>
  )
}

interface FormRow {
  id: string
  title: string
  slug: string
  template_type: 'google_review' | 'product_feedback' | 'testimonial'
  coupon_code: string | null
  submissions_count: number
  is_active: boolean
}
