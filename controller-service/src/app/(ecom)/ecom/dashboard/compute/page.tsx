import { loadOwnerContext } from '@controller/lib/ecom/owner-context'
import { requireStore } from '@controller/lib/ecom/require-store'
import { computeSpecEnabled, computePlans } from '@controller/lib/compute/catalog'
import { legacySpecFor } from '@/lib/compute/legacy'
import { getTenantCompute } from '@controller/lib/compute/store'
import { priceInrMonthForPlan } from '@controller/lib/compute/pricing-month'
import { planFeatureMatrix, COMPARISON_ROWS } from '@/lib/tenant-registry'
import { paymentRequired } from '@/lib/billing/payment-required'
import { getTenantS3UsageBytes } from '@jeffi/tenancy'
import PageHeader from '../_components/PageHeader'
import { Card } from '../_components/Card'
import { EmptyState } from '../_components/EmptyState'
import { Server } from 'lucide-react'
import ComputeClient from './ComputeClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Plan & servers' }

export default async function ComputePage({ searchParams }: { searchParams: Promise<{ tenant?: string }> }) {
  const { tenant: tenantSlug } = await searchParams
  const { tenant } = await loadOwnerContext({ tenantSlug })
  requireStore(tenant)
  const header = <PageHeader eyebrow="Store" title="Plan & servers" description="The plan your store runs on, its servers and database, and what they cost." />
  if (tenant.status !== 'active') {
    return (
      <>
        {header}
        <EmptyState icon={Server} title="Your store isn't live yet" action={{ href: '/dashboard', label: 'See setup progress' }}>
          You can change your plan and servers once your store is live.
        </EmptyState>
      </>
    )
  }
  if (!computeSpecEnabled()) {
    return (
      <>
        {header}
        <EmptyState icon={Server} title="Not available yet" action={{ href: '/dashboard/billing', label: 'See your plan' }}>
          Choosing a plan and server size is not available yet. Billing shows the plan you are on.
        </EmptyState>
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
        paymentRequired={paymentRequired(tenant)}
        paused={row?.status === 'paused'}
        plans={plans.map(p => ({ slug: p.slug, name: p.name }))}
        featureMatrix={featureMatrix}
        comparisonRows={COMPARISON_ROWS}
      />
      {s3CapGb > 0 ? (
        <Card title="File storage">
          <p className="text-sm text-foreground-secondary">
            Images and files: {s3UsedGb.toFixed(2)} GB of {s3CapGb} GB used ({s3Pct}%).
          </p>
        </Card>
      ) : null}
    </>
  )
}
