export const dynamic = 'force-dynamic'

import { listKey } from '@/lib/admin/list-key'
import { Suspense } from 'react'
import Link from 'next/link'
import { normalizeParams } from '@jeffi/list-filters/client'
import { normalizeQuery, type FilterQuery } from '@jeffi/list-filters'
import { Kpi, ListFilters, PageBody, PageHeader, TabLinks, TableSkeleton } from '@/components/admin/kit'
import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { redirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { adminCookieName } from '@/lib/auth/admin-cookie'
import { isListUrl, tabHref } from '@/lib/admin/filter-url'
import { getBusinessCustomerCounts, listBusinessCustomers } from '@/lib/admin/business-customers'
import { B2B_ENTITY } from '@/lib/filters/entities/business-customers'
import { B2B_ALIASES, B2B_FIELDS, B2B_SEARCH } from '@/lib/filters/fields/business-customers'
import BusinessCustomersTable from './_components/BusinessCustomersTable'
import B2bCustomersOverview from './_components/B2bCustomersOverview'

const PAGE_SIZE = 25

type SP = { [key: string]: string | undefined }

const CARDS = ['all', 'pending', 'approved', 'rejected'] as const

// Approval cards over the other filters; each links to the list with that approval picked.
async function BusinessCustomersStats({ q, resolved, host }: { q: FilterQuery; resolved: SP; host: string }) {
  const counts = await getBusinessCustomerCounts(q)
  const picked = q.approval ?? 'all'
  const cardHref = (s: (typeof CARDS)[number]) => {
    const p = normalizeParams(resolved, B2B_ALIASES).params
    p.delete('page')
    p.set('tab', 'list')
    if (s === 'all') p.delete('approval')
    else p.set('approval', s)
    return ap(`/admin/business/customers?${p}`, host)
  }

  return (
    <div className="animate-fade-in grid grid-cols-2 gap-3 sm:grid-cols-4">
      {CARDS.map(s => {
        const active = picked === s
        return (
          <Link
            key={s}
            href={cardHref(s)}
            className={`rounded-xl transition-shadow ${active ? 'ring-1 ring-accent-500' : 'hover:ring-1 hover:ring-border-default'}`}
          >
            <Kpi label={s} value={counts[s].toLocaleString('en-IN')} highlight={active} />
          </Link>
        )
      })}
    </div>
  )
}

async function BusinessCustomersListContent({ q, page: pageParam, host }: { q: FilterQuery; page?: string; host: string }) {
  const page = Math.max(1, parseInt(pageParam || '1', 10) || 1)
  const { rows: customers, total } = await listBusinessCustomers(q, page, PAGE_SIZE)

  return (
    <BusinessCustomersTable
      total={total}
      page={page}
      pageSize={PAGE_SIZE}
      customers={customers.map(c => ({
        user_id: c.user_id,
        email: c.email,
        first_name: c.first_name,
        last_name: c.last_name,
        company_name: c.company_name,
        gst_number: c.gst_number,
        industry: c.industry,
        approval_status: c.approval_status,
        created_at: c.created_at,
        href: ap(`/admin/business/customers/${c.user_id}/view`, host),
      }))}
    />
  )
}

export default async function BusinessCustomersPage({ searchParams }: { searchParams: Promise<SP> }) {
  // Auth gate runs synchronously in the shell — an unauthorized user is
  // redirected before any content (stats or list) is rendered/streamed.
  const resolvedSearchParams = await searchParams
  const cookieStore = await cookies()
  const token = cookieStore.get(await adminCookieName())
  const host = await getHost()
  if (!token) redirect(ap('/admin/login', host))
  const session = await verifyToken(token.value).catch(() => null)
  if (!session || !hasScope(session.role, session.scopes || [], 'business_customers:read'))
    redirect(ap('/admin/dashboard', host))

  // Overview by default; any list filter (old ?status included) or ?page opens the list.
  const showList = isListUrl(resolvedSearchParams, B2B_FIELDS, { aliases: B2B_ALIASES })
  const href = (t: string) =>
    ap(tabHref('/admin/business/customers', t, resolvedSearchParams, B2B_FIELDS, { aliases: B2B_ALIASES }), host)
  const q = normalizeQuery(B2B_ENTITY, resolvedSearchParams)

  return (
    <PageBody>
      <PageHeader title="Business Customers" description="Manage B2B partner accounts, approvals, and discounts" />

      <TabLinks
        tabs={[
          { id: 'overview', label: 'Overview', href: href('overview') },
          { id: 'list', label: 'All accounts', href: href('list') },
        ]}
        value={showList ? 'list' : 'overview'}
      />

      {!showList ? (
        <Suspense fallback={null}>
          <B2bCustomersOverview />
        </Suspense>
      ) : (
        <>
          <Suspense key={JSON.stringify(q)} fallback={<KpiRowSkeleton />}>
            <BusinessCustomersStats q={q} resolved={resolvedSearchParams} host={host} />
          </Suspense>

          <ListFilters
            entity="business_customers"
            fields={B2B_FIELDS}
            aliases={B2B_ALIASES}
            search={B2B_SEARCH}
            noun="Accounts"
            tab="list"
            exportable
          />

          {/* Table re-shimmers on filter/pagination change while the shell stays mounted */}
          <Suspense key={listKey(resolvedSearchParams)} fallback={<TableSkeleton rows={8} cols={6} />}>
            <BusinessCustomersListContent q={q} page={resolvedSearchParams.page} host={host} />
          </Suspense>
        </>
      )}
    </PageBody>
  )
}

function KpiRowSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 animate-pulse sm:grid-cols-4">
      {CARDS.map(s => (
        <div key={s} className="h-[84px] rounded-xl border border-border-default bg-surface-elevated" />
      ))}
    </div>
  )
}
