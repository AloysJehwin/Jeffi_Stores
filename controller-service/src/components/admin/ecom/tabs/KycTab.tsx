import type { ReactNode } from 'react'
import type { TenantDetail, TenantKyc, ServiceApproval } from '@/lib/tenant-registry'
import { StatusBadge, type StatusMap } from '@/components/admin/kit/status'
import { badgeCls } from '@/components/admin/kit/tones'
import ServiceApprovals from './ServiceApprovals'
import { Field, Mono, Section } from '../EcomUI'
import { KYC_STATUS, dateIN } from '../cells'
import KycActionButtons from './KycActionButtons'
import ComplianceDocRow from './ComplianceDocRow'
import { DOCS, GENERAL, complianceStanding, docStanding, todayIst } from '@controller/lib/catalog/compliance'
import type { ComplianceDocumentRow } from '@controller/lib/catalog/compliance-docs'

const BORDER: Record<string, string> = {
  pending: 'border-yellow-500/40',
  approved: 'border-green-500/40',
  rejected: 'border-red-500/40',
}

const DOC_STATUS: StatusMap = {
  pending: { label: 'Pending', tone: 'amber' },
  approved: { label: 'Approved', tone: 'green' },
  rejected: { label: 'Rejected', tone: 'red' },
  expired: { label: 'Expired', tone: 'red' },
}

// The store's licences as a whole: one rejected or expired one needs the owner.
const STANDING: StatusMap = {
  action: { label: 'Action needed', tone: 'red' },
  review: { label: 'Waiting for review', tone: 'amber' },
  ok: { label: 'All approved', tone: 'green' },
}

/** Who decided on a document and when, with the note the owner sees. */
function reviewLine(d: ComplianceDocumentRow): string | undefined {
  if (!d.reviewed_at) return d.review_note ?? undefined
  const what = d.status === 'rejected' ? 'Rejected' : 'Approved'
  return `${what} by ${d.reviewed_by ?? 'an admin'} on ${dateIN(d.reviewed_at)}${d.review_note ? `: ${d.review_note}` : ''}`
}

const link = 'text-accent-600 hover:underline text-xs whitespace-nowrap'

function DocRow({ name, detail, status, href }: { name: string; detail: ReactNode; status?: string; href?: string }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-2.5 min-w-0">
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground break-words">{name}</div>
        <div className="text-xs text-foreground-muted break-words">{detail}</div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {status && <StatusBadge status={status} map={DOC_STATUS} />}
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className={link}>
            View ↗
          </a>
        ) : (
          <span className="text-xs text-foreground-muted">Not uploaded</span>
        )}
      </div>
    </li>
  )
}

export default function KycTab({
  tenant: t,
  kyc,
  approvals = [],
  documents = [],
}: {
  tenant: TenantDetail
  kyc: TenantKyc | null
  approvals?: ServiceApproval[]
  /** Licences and certificates submitted with the application (tenant_compliance_documents). */
  documents?: ComplianceDocumentRow[]
}) {
  const services = <ServiceApprovals tenantId={t.id} services={t.service_types ?? []} approvals={approvals} />
  if (!kyc) {
    return (
      <div className="space-y-5 sm:space-y-6 min-w-0">
        <Section title="KYC & licences">
          <p className="text-sm text-foreground-muted">This workspace has not submitted KYC details yet.</p>
        </Section>
        {services}
      </div>
    )
  }

  const pending = kyc.status === 'pending'
  const today = todayIst()
  const standing = complianceStanding(documents, today)

  return (
    <div className="space-y-5 sm:space-y-6 min-w-0">
    <section className={`rounded-xl border p-4 sm:p-5 bg-surface-elevated min-w-0 ${BORDER[kyc.status] || BORDER.rejected}`}>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-semibold text-foreground">KYC & licences</h2>
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
        <Field label="GSTIN" value={kyc.gst_number ? <Mono>{kyc.gst_number}</Mono> : 'Not registered'} />
        <Field label="PAN" value={<Mono>{kyc.pan}</Mono>} />
        <Field label="Products" value={kyc.product_categories} />
        {kyc.business_address && <Field wide label="Business address" value={kyc.business_address} />}
      </dl>

      <div className="mt-5 border-t border-border-default pt-4 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Licences & certificates</h3>
          {standing && <StatusBadge status={standing} map={STANDING} />}
        </div>
        {documents.length > 0 && (
          <p className="mt-1 text-xs text-foreground-muted">
            Approve or reject each one; the owner sees your note and replaces a rejected or expired one from their console. Approving the KYC approves the ones still pending.
          </p>
        )}
        <ul className="mt-1 divide-y divide-border-default min-w-0">
          <DocRow
            name="GST registration certificate"
            detail={`${GENERAL} · optional`}
            href={kyc.gst_cert_s3_key ? `/api/admin/ecom/kyc/${t.id}/cert` : undefined}
          />
          {documents.map(d => {
            const expired = !!d.expires_on && d.expires_on < today
            const name = DOCS[d.doc_type]?.name ?? d.doc_type
            return (
              <ComplianceDocRow
                key={d.id}
                tenantId={t.id}
                docId={d.id}
                version={d.s3_key}
                name={name}
                pending={d.status === 'pending'}
                lapsed={expired}
                badge={<StatusBadge status={docStanding(d, today)} map={DOC_STATUS} />}
                href={`/api/admin/ecom/kyc/${t.id}/doc/${d.id}`}
                review={reviewLine(d)}
                detail={
                  <>
                    {d.category}
                    {d.doc_number && (
                      <>
                        {' · '}
                        <Mono>{d.doc_number}</Mono>
                      </>
                    )}
                    {d.expires_on && (
                      <span className={expired ? 'text-red-600 dark:text-red-400' : undefined}>
                        {' · '}
                        {expired ? 'expired' : 'expires'} {dateIN(d.expires_on)}
                      </span>
                    )}
                    {' · sent '}
                    {dateIN(d.created_at)}
                  </>
                }
              />
            )
          })}
        </ul>
        {!documents.length && <p className="mt-2 text-xs text-foreground-muted">No other licences on file.</p>}
      </div>
    </section>
    {services}
    </div>
  )
}
