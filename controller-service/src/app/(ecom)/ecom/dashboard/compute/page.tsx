import { loadOwnerContext } from '@controller/lib/ecom/owner-context'
import { computeSpecEnabled, computePlans } from '@controller/lib/compute/catalog'
import { legacySpecFor } from '@/lib/compute/legacy'
import { getTenantCompute } from '@controller/lib/compute/store'
import { priceInrMonthForPlan } from '@controller/lib/compute/pricing-month'
import { planFeatureMatrix, COMPARISON_ROWS } from '@/lib/tenant-registry'
import { getTenantS3UsageBytes } from '@jeffi/tenancy'
import PageHeader from '../_components/PageHeader'
import { Card } from '../_components/Card'
import ComputeClient from './ComputeClient'

export const dynamic = 'force-dynamic'

export default async function ComputePage({ searchParams }: { searchParams: Promise<{ tenant?: string }> }) {
  const { tenant: tenantSlug } = await searchParams
  const { tenant } = await loadOwnerContext({ tenantSlug })
  const header = <PageHeader eyebrow="Store" title="Plan & servers" description="The plan your store runs on, its servers and database, and what they cost." />
  if (!computeSpecEnabled() || tenant.status !== 'active') {
    return (
      <>
        {header}
        <Card>
          <p className="text-sm text-foreground-secondary">
            {tenant.status !== 'active' ? 'You can change your plan and servers once your store is live.' : 'Choosing a plan and server size is not available yet.'}
          </p>
        </Card>
      </>
    )
  }
  const [row, plans, matrix, s3Bytes] = await Promise.all([
    getTenantCompute(tenant.id),
    computePlans(),
    planFeatureMatrix(),
    getTenantS3UsageBytes(tenant.id).catch(() => 0),
  ])
  const current = row?.applied ?? legacySpecFor(tenant.plan)
  const priceInrMonth = await priceInrMonthForPlan(tenant.plan ?? 'basic', current).catch(() => null)
  const featureMatrix = Object.fromEntries(Object.entries(matrix).map(([k, v]) => [k, Array.from(v)]))
  const s3CapGb = (row?.desired ?? current)?.storage?.s3Gb ?? 0
  const s3UsedGb = s3Bytes / (1024 * 1024 * 1024)
  const s3Pct = s3CapGb > 0 ? Math.min(100, Math.round((s3UsedGb / s3CapGb) * 100)) : 0
  return (
    <>
      {header}
      <ComputeClient
        tenantId={tenant.id}
        planSlug={tenant.plan ?? 'basic'}
        billingInterval={tenant.billing_interval === 'yearly' ? 'yearly' : 'monthly'}
        current={current}
        change={
          row && row.status !== 'applied' && row.status !== 'paused'
            ? { desired: row.desired, status: row.status, error: row.last_error, applyMode: row.apply_mode }
            : null
        }
        priceInrMonth={priceInrMonth}
        paymentsEnabled={process.env.ECOM_PAYMENTS_ENABLED === 'true'}
        paused={row?.status === 'paused'}
        plans={plans.map(p => ({ slug: p.slug, name: p.name }))}
        featureMatrix={featureMatrix}
        comparisonRows={COMPARISON_ROWS}
      />
      {s3CapGb > 0 ? (
        <Card>
          <p className="text-sm text-foreground-secondary">
            S3 storage: {s3UsedGb.toFixed(2)} GB of {s3CapGb} GB used ({s3Pct}%).
          </p>
        </Card>
      ) : null}
    </>
  )
}
