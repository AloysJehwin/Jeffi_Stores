import { Suspense } from 'react'
import { Plus } from 'lucide-react'
import { TabAction } from '@/components/admin/channels/ui'
import { queryMany, queryCount } from '@/lib/shared/db'
import DraftRowActions from '@/components/admin/DraftRowActions'
import ReviewFormsTable, { type FormRow } from './_components/ReviewFormsTable'
import { DataToolbar, PageBody, PageHeader, TableSkeleton } from '@/components/admin/kit'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { formsHostForHost } from '@/lib/tenant-registry'
import { resolveListTab } from '@/lib/overviews/marketing'
import OverviewTabs from '../coupons/_components/OverviewTabs'
import ReviewFormsOverview from './_components/ReviewFormsOverview'

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
  const sp = await searchParams
  const tab = resolveListTab(sp, ['search', 'page'])

  return (
    <PageBody>
      <PageHeader title="Review Forms" description="Shareable forms that reward customers for Google reviews" />

      <OverviewTabs
        basePath={ap('/admin/review-forms', host)}
        active={tab}
        sp={sp}
        listLabel="Forms"
        actions={
          <span className="hidden md:inline-flex">
            <TabAction
              href={ap('/admin/review-forms/add', host)}
              icon={<Plus className="w-4 h-4" />}
              label="Create Form"
            />
          </span>
        }
      />

      {tab === 'overview' ? (
        <Suspense fallback={null}>
          <ReviewFormsOverview />
        </Suspense>
      ) : (
        <>
          <DataToolbar
            search={{ placeholder: 'Search by title or slug...', param: 'search', suggestType: 'review_forms' }}
          />

          <Suspense fallback={null}>
            <ReviewFormsDraftsBanner host={host} />
          </Suspense>

          <ReviewFormsListSection searchParams={searchParams} host={host} />
        </>
      )}
    </PageBody>
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
    <details className="group rounded-xl border border-amber-500/40 bg-amber-500/5">
      <summary className="cursor-pointer list-none flex flex-wrap items-center justify-between gap-2 px-4 h-11">
        <span className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-400">
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
        <span className="text-xs text-foreground-muted">Not yet published to the live list</span>
      </summary>
      <div className="border-t border-amber-500/30 overflow-hidden">
        <div className="divide-y divide-amber-500/20">
          {/* Create-drafts: brand-new forms not yet on the live list. Publish activates them. */}
          {createDrafts.map(d => (
            <DraftRowActions
              key={`new-${d.id}`}
              entityId={d.id}
              name={d.title}
              subtitle="New form — not yet published"
              updatedAt={d.created_at}
              editHref={ap(`/admin/review-forms/${d.id}/edit`, host)}
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
              editHref={ap(`/admin/review-forms/${d.form_id}/edit`, host)}
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
    <Suspense key={key} fallback={<TableSkeleton rows={8} cols={6} />}>
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

  const currentListUrl = (() => {
    const params = new URLSearchParams({ tab: 'list' })
    if (resolvedSearchParams.search) params.set('search', resolvedSearchParams.search)
    if (page > 1) params.set('page', String(page))
    const qs = params.toString()
    return `/admin/review-forms${qs ? `?${qs}` : ''}`
  })()

  return (
    <ReviewFormsTable
      forms={forms as FormRow[]}
      total={total}
      page={page}
      pageSize={PAGE_SIZE}
      search={resolvedSearchParams.search}
      backUrl={currentListUrl}
      formsBase={formsBase}
    />
  )
}
