import { loadOwnerContext } from '@controller/lib/ecom/owner-context'
import { computeSpecEnabled, planCompute } from '@controller/lib/compute/catalog'
import { legacySpecFor } from '@/lib/compute/legacy'
import { getTenantCompute } from '@controller/lib/compute/store'
import { serversBilling } from '@controller/lib/billing/infra-status'
import PageHeader from '../_components/PageHeader'
import { Card } from '../_components/Card'
import ComputeClient from './ComputeClient'

export const dynamic = 'force-dynamic'

export default async function ComputePage({ searchParams }: { searchParams: Promise<{ tenant?: string }> }) {
  const { tenant: tenantSlug } = await searchParams
  const { tenant } = await loadOwnerContext({ tenantSlug })
  const header = <PageHeader eyebrow="Store" title="Servers" description="The servers and database your store runs on, and what they cost." />
  if (!computeSpecEnabled() || tenant.status !== 'active') {
    return (
      <>
        {header}
        <Card>
          <p className="text-sm text-foreground-secondary">
            {tenant.status !== 'active' ? 'You can change your servers once your store is live.' : 'Choosing server sizes is not available yet.'}
          </p>
        </Card>
      </>
    )
  }
  const [row, plan, servers] = await Promise.all([
    getTenantCompute(tenant.id),
    planCompute(tenant.plan ?? ''),
    serversBilling(tenant.id).catch(() => null),
  ])
  const current = row?.applied ?? legacySpecFor(tenant.plan)
  return (
    <>
      {header}
      <ComputeClient
        tenantId={tenant.id}
        planSlug={tenant.plan ?? 'basic'}
        planFeeInr={plan?.monthlyPriceInr ?? 0}
        current={current}
        change={
          row && row.status !== 'applied' && row.status !== 'paused'
            ? { desired: row.desired, status: row.status, error: row.last_error, applyMode: row.apply_mode }
            : null
        }
        rateInrHour={row?.rate_inr_hour ? Number(row.rate_inr_hour) : null}
        paused={row?.status === 'paused'}
        servers={servers}
      />
    </>
  )
}
