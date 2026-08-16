import { headers } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { hasScope } from '@/lib/scopes'
import { getTenant, getTenantBilling } from '@/lib/tenant-registry'
import { StatusPill } from '@/components/admin/ecom/EcomUI'
import TenantActions from '@/components/admin/ecom/TenantActions'

export const dynamic = 'force-dynamic'

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-foreground-muted">{label}</dt>
      <dd className="text-sm text-foreground mt-0.5">{value ?? '—'}</dd>
    </div>
  )
}

export default async function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const h = await headers()
  const role = h.get('x-user-role') || ''
  const scopes = (h.get('x-user-scopes') || '').split(',').filter(Boolean)
  if (role !== 'super_admin' && !hasScope(role, scopes, 'ecom_customers:read')) redirect('/admin')

  const { id } = await params
  const t = await getTenant(id)
  if (!t) notFound()
  const billing = await getTenantBilling(id).catch(() => null)

  return (
    <div className="p-6 w-full">
      <Link href="/admin/ecom/customers" className="text-sm text-accent-600 dark:text-accent-400 hover:underline">← Customers</Link>
      <div className="flex items-center gap-3 mt-2 mb-6">
        <h1 className="text-2xl font-bold text-foreground">{t.display_name}</h1>
        <StatusPill status={t.status} />
      </div>

      <div className="mb-6">
        <TenantActions tenantId={t.id} slug={t.slug} status={t.status} instanceState={t.instance_state} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="rounded-xl border border-border-default p-5 bg-surface-elevated">
          <h2 className="font-semibold text-foreground mb-4">Store</h2>
          <dl className="grid grid-cols-2 gap-4">
            <Field label="Subdomain" value={`${t.slug}.jeffistores.in`} />
            <Field label="Custom domain" value={t.custom_domain} />
            <Field label="Plan" value={<span className="capitalize">{t.plan || '—'}</span>} />
            <Field label="Monthly" value={t.monthly_price_inr ? `₹${Number(t.monthly_price_inr).toLocaleString('en-IN')}` : '—'} />
            <Field label="Payout" value={t.daily_payout ? 'Daily (+5%)' : 'Weekly'} />
            <Field label="Created" value={new Date(t.created_at).toLocaleDateString('en-IN')} />
          </dl>
        </section>

        <section className="rounded-xl border border-border-default p-5 bg-surface-elevated">
          <h2 className="font-semibold text-foreground mb-4">Infrastructure</h2>
          <dl className="grid grid-cols-2 gap-4">
            <Field label="RDS endpoint" value={<span className="font-mono text-xs break-all">{t.rds_endpoint || <span className="text-amber-500">not provisioned</span>}</span>} />
            <Field label="Database" value={t.rds_db} />
            <Field label="S3 bucket" value={<span className="font-mono text-xs">{t.s3_bucket}</span>} />
            <Field label="EC2 target" value={t.ec2_target || 'pool'} />
            <Field label="Region" value={t.region} />
            <Field label="CloudFront" value={t.cloudfront_id} />
          </dl>
        </section>
      </div>

      {billing && (
        <section className="rounded-xl border border-border-default p-5 bg-surface-elevated mt-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-foreground">Billing snapshot</h2>
            <Link href={`/admin/ecom/billing/${t.id}`} className="text-sm text-accent-600 dark:text-accent-400 hover:underline">View full billing →</Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Field label="Settlement balance" value={<span className={billing.balance >= 0 ? 'text-green-600' : 'text-red-600'}>₹{billing.balance.toLocaleString('en-IN')}</span>} />
            <Field label="GMV" value={`₹${billing.totals.gross.toLocaleString('en-IN')}`} />
            <Field label="Your commission" value={`₹${billing.totals.commission.toLocaleString('en-IN')}`} />
            <Field label="Transactions" value={billing.transactions.length} />
          </div>
        </section>
      )}
    </div>
  )
}
