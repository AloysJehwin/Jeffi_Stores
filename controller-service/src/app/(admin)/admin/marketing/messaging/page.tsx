import { Suspense } from 'react'
import { listKey } from '@/lib/admin/list-key'
import { Plus } from 'lucide-react'
import { TabAction } from '@/components/admin/channels/ui'
import { queryMany, queryCount } from '@/lib/shared/db'
import { DataToolbar, PageBody, PageHeader, TableSkeleton } from '@/components/admin/kit'
import { TONE_CLS } from '@/components/admin/kit/tones'
import MessagingTable, { type Campaign } from './_components/MessagingTable'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import MessagingOverview from './_components/MessagingOverview'
import OverviewTabs from '../../coupons/_components/OverviewTabs'
import { resolveListTab } from '@/lib/overviews/marketing'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const PAGE_SIZE = 20

const TEMPLATE_LABELS: Record<string, string> = {
  review_form_share: 'Review Form Share',
  promotion: 'Promotion',
  event: 'Event',
  announcement: 'Announcement',
  custom: 'Custom',
}

const STATUS_STYLES: Record<string, string> = {
  draft: TONE_CLS.muted,
  scheduled: TONE_CLS.blue,
  sending: TONE_CLS.amber,
  sent: TONE_CLS.green,
  failed: TONE_CLS.red,
}

export default async function MailerPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string; tab?: string; from?: string; to?: string }>
}) {
  const host = await getHost()
  const sp = await searchParams
  const tab = resolveListTab(sp, ['page', 'search'])
  return (
    <PageBody>
      <PageHeader title="Messaging" description="Send email, SMS and WhatsApp messages to your customers" />

      <OverviewTabs
        basePath={ap('/admin/marketing/messaging', host)}
        active={tab}
        sp={sp}
        listLabel="Messages"
        actions={
          <span className="hidden md:inline-flex">
            <TabAction
              href={ap('/admin/marketing/messaging/new', host)}
              icon={<Plus className="w-4 h-4" />}
              label="New message"
            />
          </span>
        }
      />

      {tab === 'overview' ? (
        <Suspense fallback={null}>
          <MessagingOverview />
        </Suspense>
      ) : (
        <>
          <DataToolbar search={{ placeholder: 'Search by title or subject...', param: 'search' }} />
          <MailerListSection searchParams={searchParams} />
        </>
      )}
    </PageBody>
  )
}

// Resolves searchParams (no DB — near-instant) then keys the table Suspense
// on the query string so filter/pagination changes re-trigger the shimmer
// while the header + filters above stay mounted.
async function MailerListSection({ searchParams }: { searchParams: Promise<{ page?: string; search?: string }> }) {
  const resolvedSearchParams = await searchParams
  const key = listKey(resolvedSearchParams)
  return (
    <Suspense key={key} fallback={<TableSkeleton rows={8} cols={6} />}>
      <MailerListContent resolvedSearchParams={resolvedSearchParams} />
    </Suspense>
  )
}

async function MailerListContent({
  resolvedSearchParams,
}: {
  resolvedSearchParams: { page?: string; search?: string }
}) {
  const host = await getHost()
  const page = Math.max(1, parseInt(resolvedSearchParams.page || '1', 10))
  const search = resolvedSearchParams.search?.trim() || ''
  const offset = (page - 1) * PAGE_SIZE

  const conditions: string[] = []
  const params: unknown[] = []
  let i = 1

  if (search) {
    conditions.push(`(title ILIKE $${i} OR subject ILIKE $${i})`)
    params.push(`%${search}%`)
    i++
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  let campaigns: Campaign[] = []
  let total = 0
  let migrationPending = false

  try {
    ;[campaigns, total] = await Promise.all([
      queryMany<Campaign>(
        `SELECT id, title, template_key, channels, subject, audience_type, recipient_count, status, scheduled_at, sent_at, created_at
         FROM email_campaigns ${where} ORDER BY created_at DESC LIMIT $${i} OFFSET $${i + 1}`,
        [...params, PAGE_SIZE, offset]
      ),
      queryCount(`SELECT COUNT(*) FROM email_campaigns ${where}`, params),
    ])
  } catch {
    migrationPending = true
  }

  const currentListUrl = (() => {
    const params = new URLSearchParams({ tab: 'list' })
    if (search) params.set('search', search)
    if (page > 1) params.set('page', String(page))
    return `/admin/marketing/messaging?${params}`
  })()

  if (migrationPending) {
    return (
      <div className="max-w-xl rounded-xl border border-amber-500/40 bg-amber-500/5 p-5">
        <h2 className="font-semibold text-amber-700 dark:text-amber-400 mb-2">Database migration required</h2>
        <p className="text-sm text-foreground mb-3">
          The <code className="font-mono bg-amber-500/10 px-1 rounded">email_campaigns</code> table does not exist yet.
          It is defined in the schema file below and is created by the schema pipeline:
        </p>
        <pre className="bg-amber-500/10 rounded-lg px-4 py-3 text-xs font-mono text-amber-700 dark:text-amber-400 overflow-x-auto">
          database/marketing.sql
        </pre>
      </div>
    )
  }

  return (
    <MessagingTable
      campaigns={campaigns}
      total={total}
      page={page}
      pageSize={PAGE_SIZE}
      search={search}
      host={host}
      currentListUrl={currentListUrl}
      templateLabels={TEMPLATE_LABELS}
      statusStyles={STATUS_STYLES}
    />
  )
}
