import { headers } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { isPlatformAdmin } from '@/lib/scopes'
import { getTenant, getTenantBilling, getKyc } from '@/lib/tenant-registry'
import { StatusPill } from '@/components/admin/ecom/EcomUI'
import TenantActions from '@/components/admin/ecom/TenantActions'
import KycActionButtons from '../../kyc/KycActionButtons'

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
  if (!isPlatformAdmin(role)) redirect('/admin')

  const { id } = await params
  const [t, billing, kyc] = await Promise.all([
    getTenant(id),
    getTenantBilling(id).catch(() => null),
    getKyc(id).catch(() => null),
  ])
  if (!t) notFound()

  const kycPending = kyc && kyc.status === 'pending'

  return (
    <div className="p-6 w-full">
      <Link href="/admin/ecom/customers" className="text-sm text-accent-600 dark:text-accent-400 hover:underline">← Customers</Link>
      <div className="flex items-center gap-3 mt-2 mb-6">
        <h1 className="text-2xl font-bold text-foreground">{t.display_name}</h1>
        <StatusPill status={t.status} />
        {kycPending && (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
            KYC pending review
          </span>
        )}
      </div>

      <div className="mb-6">
        <TenantActions tenantId={t.id} slug={t.slug} status={t.status} instanceState={t.instance_state} />
      </div>

      {/* ── KYC Review ── */}
      {kyc && (
        <section className={`rounded-xl border p-5 bg-surface-elevated mb-6 ${kycPending ? 'border-yellow-300 dark:border-yellow-700' : kyc.status === 'approved' ? 'border-green-300 dark:border-green-700' : 'border-red-300 dark:border-red-700'}`}>
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <h2 className="font-semibold text-foreground">KYC / GST Verification</h2>
              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${
                kyc.status === 'approved' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                kyc.status === 'rejected' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
              }`}>{kyc.status}</span>
            </div>
            {kycPending && <KycActionButtons tenantId={t.id} mode="pending" />}
            {/* Approved but no checkout URL — Razorpay sub creation failed, allow retry */}
            {kyc.status === 'approved' && t.status === 'provisioning' && !t.razorpay_checkout_url && (
              <KycActionButtons tenantId={t.id} mode="retry" />
            )}
            {kyc.status === 'approved' && t.razorpay_checkout_url && (
              <div className="text-xs text-foreground-muted">
                Approved by {kyc.reviewed_by} on {kyc.reviewed_at ? new Date(kyc.reviewed_at).toLocaleDateString('en-IN') : '—'}
              </div>
            )}
            {kyc.status === 'rejected' && (
              <div className="text-xs text-red-600 dark:text-red-400">
                Rejected by {kyc.reviewed_by} — {kyc.reviewer_note}
              </div>
            )}
          </div>

          <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            <Field label="Business name" value={kyc.business_name} />
            <Field label="Business type" value={kyc.business_type} />
            <Field label="GSTIN" value={<span className="font-mono text-xs">{kyc.gst_number}</span>} />
            <Field label="PAN" value={<span className="font-mono text-xs">{kyc.pan}</span>} />
            <Field label="Products" value={kyc.product_categories} />
            {kyc.business_address && (
              <div className="col-span-2">
                <dt className="text-xs uppercase tracking-wide text-foreground-muted">Business address</dt>
                <dd className="text-sm text-foreground mt-0.5">{kyc.business_address}</dd>
              </div>
            )}
            <Field label="GST certificate" value={
              kyc.gst_cert_s3_key
                ? <a href={`/api/admin/ecom/kyc/${t.id}/cert`} target="_blank" rel="noopener noreferrer" className="text-accent-600 dark:text-accent-400 hover:underline text-xs">View certificate ↗</a>
                : <span className="text-foreground-muted">Not uploaded</span>
            } />
          </dl>
        </section>
      )}

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
