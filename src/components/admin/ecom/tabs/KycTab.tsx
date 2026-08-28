import type { TenantDetail, TenantKyc } from '@/lib/tenant-registry'
import { Field, Mono, Section } from '../EcomUI'
import KycActionButtons from '@/app/admin/ecom/kyc/KycActionButtons'

const BORDER: Record<string, string> = {
  pending:  'border-yellow-300 dark:border-yellow-700',
  approved: 'border-green-300 dark:border-green-700',
  rejected: 'border-red-300 dark:border-red-700',
}

const BADGE: Record<string, string> = {
  pending:  'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  approved: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

export default function KycTab({ tenant: t, kyc }: { tenant: TenantDetail; kyc: TenantKyc | null }) {
  if (!kyc) {
    return (
      <Section title="KYC / GST Verification">
        <p className="text-sm text-foreground-muted">This store has not submitted KYC details yet.</p>
      </Section>
    )
  }

  const pending = kyc.status === 'pending'

  return (
    <section className={`rounded-xl border p-5 bg-surface-elevated min-w-0 ${BORDER[kyc.status] || BORDER.rejected}`}>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h2 className="font-semibold text-foreground">KYC / GST Verification</h2>
          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${BADGE[kyc.status] || BADGE.rejected}`}>
            {kyc.status}
          </span>
        </div>

        {pending && <KycActionButtons tenantId={t.id} mode="pending" />}
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

      <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 min-w-0">
        <Field label="Business name" value={kyc.business_name} />
        <Field label="Business type" value={kyc.business_type} />
        <Field label="GSTIN" value={<Mono>{kyc.gst_number}</Mono>} />
        <Field label="PAN" value={<Mono>{kyc.pan}</Mono>} />
        <Field label="Products" value={kyc.product_categories} />
        {kyc.business_address && <Field wide label="Business address" value={kyc.business_address} />}
        <Field
          label="GST certificate"
          value={kyc.gst_cert_s3_key
            ? <a href={`/api/admin/ecom/kyc/${t.id}/cert`} target="_blank" rel="noopener noreferrer" className="text-accent-600 dark:text-accent-400 hover:underline text-xs">View certificate ↗</a>
            : <span className="text-foreground-muted">Not uploaded</span>}
        />
      </dl>
    </section>
  )
}
