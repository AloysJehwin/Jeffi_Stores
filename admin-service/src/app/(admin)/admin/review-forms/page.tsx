import { Suspense } from 'react'
import { buildWhere, normalizeQuery, sortClause, type FilterQuery, type SortDef } from '@jeffi/list-filters'
import { listKey } from '@/lib/admin/list-key'
import { isListUrl, tabHref } from '@/lib/admin/filter-url'
import { Plus } from 'lucide-react'
import { TabAction } from '@/components/admin/channels/ui'
import { queryMany, queryCount } from '@/lib/shared/db'
import DraftRowActions from '@/components/admin/DraftRowActions'
import { draftLockChips } from '@/lib/admin/draft-locks'
import ReviewFormsTable, { type FormRow } from './_components/ReviewFormsTable'
import { ListFilters, PageBody, PageHeader, TabLinks, TableSkeleton } from '@/components/admin/kit'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { formsHostForHost } from '@/lib/tenant-registry'
import { REVIEW_FORMS_ENTITY } from '@/lib/filters/entities/review-forms'
import { REVIEW_FORM_FIELDS, REVIEW_FORM_SEARCH } from '@/lib/filters/fields/review-forms'
import ReviewFormsOverview from './_components/ReviewFormsOverview'
import PageDrafts, { DraftsTabLabel } from '@/components/admin/drafts/PageDrafts'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const PAGE_SIZE = 25

type SP = { [key: string]: string | undefined }

const FORM_SORT: SortDef = {
  sorts: {
    title: 'rf.title',
    template: 'rf.template_type',
    link: 'rf.slug',
    coupon: 'c.code',
    subs: 'rf.submissions_count',
    status: '(NOT rf.is_active)',
  },
  defaultSql: 'rf.created_at DESC',
  tiebreak: 'rf.id DESC',
}

async function getForms(q: FilterQuery, page = 1, sp: SP = {}) {
  const w = buildWhere(REVIEW_FORMS_ENTITY, q)
  const offset = (page - 1) * PAGE_SIZE
  const [forms, total] = await Promise.all([
    queryMany(
      `SELECT rf.*, c.code AS coupon_code FROM review_forms rf LEFT JOIN coupons c ON rf.coupon_id = c.id ${w.where} ${sortClause({ get: k => sp[k] ?? null }, FORM_SORT)} LIMIT $${w.nextIdx} OFFSET $${w.nextIdx + 1}`,
      [...w.params, PAGE_SIZE, offset]
    ),
    queryCount(`SELECT COUNT(*) FROM review_forms rf ${w.where}`, w.params),
  ])

  return { forms, total }
}

export default async function ReviewFormsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const host = await getHost()
  const sp = await searchParams
  const tab = sp.tab === 'drafts' ? 'drafts' : isListUrl(sp, REVIEW_FORM_FIELDS) ? 'list' : 'overview'
  const href = (t: string) => ap(tabHref('/admin/review-forms', t, sp, REVIEW_FORM_FIELDS), host)

  return (
    <PageBody>
      <PageHeader title="Review Forms" description="Shareable forms that reward customers for Google reviews" />

      <div className="mb-5">
        <TabLinks
          tabs={[
            { id: 'overview', label: 'Overview', href: href('overview') },
            { id: 'list', label: 'Forms', href: href('list') },
            { id: 'drafts', label: <DraftsTabLabel type="review_form" />, href: href('drafts') },
          ]}
          value={tab}
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
      </div>

      {tab === 'overview' ? (
        <Suspense fallback={null}>
          <ReviewFormsOverview />
        </Suspense>
      ) : tab === 'drafts' ? (
        <PageDrafts type="review_form">
          <Suspense fallback={null}>
            <ReviewFormsDraftsBanner host={host} />
          </Suspense>
        </PageDrafts>
      ) : (
        <>
          <ListFilters
            entity="review_forms"
            fields={REVIEW_FORM_FIELDS}
            search={REVIEW_FORM_SEARCH}
            noun="Forms"
            tab="list"
            exportable
          />

          <ReviewFormsListSection resolvedSearchParams={sp} host={host} />
        </>
      )}
    </PageBody>
  )
}

async function ReviewFormsDraftsBanner({ host }: { host: string }) {
  const [pendingDrafts, createDrafts] = await Promise.all([
    // Edit-drafts: one row per draft (several admins can each hold one of the same form).
    queryMany<{ id: string; form_id: string; name: string; title: string | null; author: string | null; updated_at: string }>(
      `SELECT rfd.id, rfd.form_id, rf.title AS name, rfd.title, rfd.updated_at,
              COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email) AS author
       FROM review_form_drafts rfd
       JOIN review_forms rf ON rf.id = rfd.form_id
       LEFT JOIN admins ad ON ad.id = rfd.author_admin_id LEFT JOIN users u ON u.id = ad.user_id
       ORDER BY rfd.updated_at DESC
       LIMIT 200`
    ),
    // Create-drafts: brand-new forms never published to the live list (is_draft = true).
    queryMany<{ id: string; title: string; created_at: string }>(
      `SELECT id, title, created_at FROM review_forms WHERE is_draft = true ORDER BY created_at DESC LIMIT 200`
    ),
  ])

  const pendingDraftsCount = pendingDrafts.length + createDrafts.length
  if (pendingDraftsCount === 0) return null
  const locks = await draftLockChips('review_form', [...createDrafts.map(d => d.id), ...pendingDrafts.map(d => d.id)])

  return (
    <details open className="group rounded-xl border border-amber-500/40 bg-amber-500/5">
      <summary className="cursor-pointer list-none flex flex-wrap items-center justify-between gap-2 px-4 min-h-11 py-2 sm:h-11 sm:py-0">
        <span className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-400">
          <svg
            className="w-4 h-4 transition-transform group-open:rotate-90"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          Ready to publish ({pendingDraftsCount})
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
              lock={locks[d.id]}
            />
          ))}
          {pendingDrafts.map(d => (
            <DraftRowActions
              key={d.id}
              entityId={d.form_id}
              name={d.title ? `${d.name} · ${d.title}` : d.name}
              subtitle={d.author ? `Draft by ${d.author}` : null}
              updatedAt={d.updated_at}
              editHref={ap(`/admin/review-forms/${d.form_id}/edit?draft=${d.id}`, host)}
              publishPath={`/api/admin/review-forms/${d.form_id}/publish?draft=${d.id}`}
              discardPath={`/api/admin/review-forms/${d.form_id}/draft?draft=${d.id}`}
              entityLabel="review form"
              lock={locks[d.id]}
            />
          ))}
        </div>
      </div>
    </details>
  )
}

// Keys the table Suspense on the query string so filter changes re-trigger the shimmer.
function ReviewFormsListSection({ resolvedSearchParams, host }: { resolvedSearchParams: SP; host: string }) {
  return (
    <Suspense key={listKey(resolvedSearchParams)} fallback={<TableSkeleton rows={8} cols={6} />}>
      <ReviewFormsListContent resolvedSearchParams={resolvedSearchParams} host={host} />
    </Suspense>
  )
}

async function ReviewFormsListContent({ resolvedSearchParams, host }: { resolvedSearchParams: SP; host: string }) {
  const page = Math.max(1, parseInt(resolvedSearchParams.page || '1', 10))
  const q = normalizeQuery(REVIEW_FORMS_ENTITY, resolvedSearchParams)
  const { forms, total } = await getForms(q, page, resolvedSearchParams)
  const formsBase = `https://${formsHostForHost(host)}`
  const listUrl = tabHref('/admin/review-forms', 'list', resolvedSearchParams, REVIEW_FORM_FIELDS)

  return (
    <ReviewFormsTable
      forms={forms as FormRow[]}
      total={total}
      page={page}
      pageSize={PAGE_SIZE}
      search={q.search}
      backUrl={page > 1 ? `${listUrl}&page=${page}` : listUrl}
      formsBase={formsBase}
    />
  )
}
