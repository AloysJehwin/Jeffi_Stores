import type { TenantDetail, TenantKyc, ServiceApproval } from '@/lib/tenant-registry'
import { StatusBadge } from '@/components/admin/kit/status'
import { badgeCls } from '@/components/admin/kit/tones'
import ServiceApprovals from './ServiceApprovals'
import { Field, Mono, Section } from '../EcomUI'
import { KYC_STATUS, dateIN } from '../cells'
import KycActionButtons from './KycActionButtons'

const BORDER: Record<string, string> = {
  pending: 'border-yellow-500/40',
  approved: 'border-green-500/40',
  rejected: 'border-red-500/40',
}

export default function KycTab({ tenant: t, kyc, approvals = [] }: { tenant: TenantDetail; kyc: TenantKyc | null; approvals?: ServiceApproval[] }) {
  const services = <ServiceApprovals tenantId={t.id} services={t.service_types ?? []} approvals={approvals} />
  if (!kyc) {
    return (
      <div className="space-y-5 sm:space-y-6 min-w-0">
        <Section title="KYC / GST Verification">
          <p className="text-sm text-foreground-muted">This workspace has not submitted KYC details yet.</p>
        </Section>
        {services}
      </div>
    )
  }

  const pending = kyc.status === 'pending'

  return (
    <div className="space-y-5 sm:space-y-6 min-w-0">
    <section className={`rounded-xl border p-4 sm:p-5 bg-surface-elevated min-w-0 ${BORDER[kyc.status] || BORDER.rejected}`}>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-semibold text-foreground">KYC / GST Verification</h2>
          <StatusBadge status={kyc.status} map={KYC_STATUS} />
          {t.store_request && <span className={badgeCls('amber')}>Store upgrade</span>}
        </div>

        {pending && <KycActionButtons tenantId={t.id} mode="pending" />}
        {/* Approved but no checkout URL — Razorpay sub creation failed, allow retry */}
        {kyc.status === 'approved' && t.status === 'provisioning' && !t.razorpay_checkout_url && (
          <KycActionButtons tenantId={t.id} mode="retry" />
        )}
        {kyc.status === 'approved' && t.razorpay_checkout_url && (
          <div className="text-xs text-foreground-muted">
            Approved by {kyc.reviewed_by} on {dateIN(kyc.reviewed_at)}
          </div>
        )}
        {kyc.status === 'rejected' && (
          <div className="text-xs text-red-600 dark:text-red-400 break-words">
            Rejected by {kyc.reviewed_by}: {kyc.reviewer_note}
          </div>
        )}
      </div>

      <dl className="grid grid-cols-1 min-[420px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 min-w-0">
        <Field label="Business name" value={kyc.business_name} />
        <Field label="Business type" value={kyc.business_type} />
        <Field label="GSTIN" value={<Mono>{kyc.gst_number}</Mono>} />
        <Field label="PAN" value={<Mono>{kyc.pan}</Mono>} />
        <Field label="Products" value={kyc.product_categories} />
        {kyc.business_address && <Field wide label="Business address" value={kyc.business_address} />}
        <Field
          label="GST certificate"
          value={
            kyc.gst_cert_s3_key ? (
              <a
                href={`/api/admin/ecom/kyc/${t.id}/cert`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-600 hover:underline text-xs"
              >
                View certificate ↗
              </a>
            ) : (
              <span className="text-foreground-muted">Not uploaded</span>
            )
          }
        />
      </dl>
    </section>
    {services}
    </div>
  )
}
