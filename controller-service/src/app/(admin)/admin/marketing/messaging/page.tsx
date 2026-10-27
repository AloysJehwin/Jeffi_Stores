import { Suspense } from 'react'
import { normalizeQuery } from '@jeffi/list-filters'
import { listKey } from '@/lib/admin/list-key'
import { Plus } from 'lucide-react'
import { TabAction } from '@/components/admin/channels/ui'
import { ListFilters, PageBody, PageHeader, TabLinks, TableSkeleton } from '@/components/admin/kit'
import { TONE_CLS } from '@/components/admin/kit/tones'
import MessagingTable, { type Campaign } from './_components/MessagingTable'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import MessagingOverview from './_components/MessagingOverview'
import { isListUrl, tabHref } from '@/lib/admin/filter-url'
import { listCampaigns } from '@/lib/admin/messaging'
import { MESSAGING_ENTITY } from '@/lib/filters/entities/messaging'
import { MESSAGING_FIELDS, MESSAGING_SEARCH } from '@/lib/filters/fields/messaging'
import { getDraftLockMap } from '@/lib/admin/draft-locks'
import { getAdminSession } from '@/lib/auth/admin-auth'
import { getFeatureFlags } from '@/lib/catalog/site-controls'
import PageDrafts from '@/components/admin/drafts/PageDrafts'

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

type SP = Record<string, string | undefined>

export default async function MailerPage({ searchParams }: { searchParams: Promise<SP> }) {
  const [host, sp, flags] = await Promise.all([getHost(), searchParams, getFeatureFlags()])
  // Only the channels Site Controls leaves on.
  const sends = ['email', flags.smsEnabled && 'SMS', flags.whatsappEnabled && 'WhatsApp'].filter(Boolean).join(', ')
  const tab = isListUrl(sp, MESSAGING_FIELDS) ? 'list' : 'overview'
  const href = (t: string) => ap(tabHref('/admin/marketing/messaging', t, sp, MESSAGING_FIELDS), host)
  return (
    <PageBody>
      <PageHeader title="Messaging" description={`Send ${sends.replace(/, ([^,]*)$/, ' and $1')} messages to your customers`} />

      <TabLinks
        tabs={[
          { id: 'overview', label: 'Overview', href: href('overview') },
          { id: 'list', label: 'Messages', href: href('list') },
        ]}
        value={tab}
        actions={
          <TabAction
            href={ap('/admin/marketing/messaging/new', host)}
            icon={<Plus className="w-4 h-4" />}
            label="New message"
          />
        }
      />

      {tab === 'overview' ? (
        <Suspense fallback={null}>
          <MessagingOverview />
        </Suspense>
      ) : (
        <>
          <PageDrafts type="mailer" />
          <ListFilters entity="messaging" fields={MESSAGING_FIELDS} search={MESSAGING_SEARCH} noun="Messages" tab="list" exportable />
          <Suspense key={listKey(sp)} fallback={<TableSkeleton rows={8} cols={6} />}>
            <MailerListContent resolvedSearchParams={sp} />
          </Suspense>
        </>
      )}
    </PageBody>
  )
}

async function MailerListContent({ resolvedSearchParams }: { resolvedSearchParams: SP }) {
  const host = await getHost()
  const page = Math.max(1, parseInt(resolvedSearchParams.page || '1', 10) || 1)
  const q = normalizeQuery(MESSAGING_ENTITY, resolvedSearchParams)
  const search = q.search ?? ''

  let campaigns: Campaign[] = []
  let total = 0
  let migrationPending = false

  try {
    ;({ campaigns, total } = await listCampaigns<Campaign>(q, page, PAGE_SIZE, { get: k => resolvedSearchParams[k] ?? null }))
  } catch {
    migrationPending = true
  }
  // Who is editing each draft (owner badge).
  const [locks, session] = await Promise.all([
    getDraftLockMap('mailer', campaigns.filter(c => c.status === 'draft').map(c => c.id)),
    getAdminSession(),
  ])

  // Back link from a message: this tab, these filters, this page.
  const currentListUrl = (() => {
    const params = new URLSearchParams({ tab: 'list', ...q })
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
      locks={locks}
      meId={session?.adminId ?? null}
    />
  )
}
