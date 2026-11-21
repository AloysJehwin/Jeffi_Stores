import type { ReactNode } from 'react'
import type { TenantDetail, TenantKyc, ServiceApproval } from '@/lib/tenant-registry'
import { paymentRequired } from '@/lib/billing/payment-required'
import { StatusBadge, type StatusMap } from '@/components/admin/kit/status'
import { badgeCls } from '@/components/admin/kit/tones'
import type { KybService } from '@controller/lib/kyb/requirements'
import type { KybView } from '@controller/lib/kyb/view'
import ServiceApprovals from './ServiceApprovals'
import { Field, Mono, Section } from '../EcomUI'
import { KYC_STATUS, dateIN } from '../cells'
import KycActionButtons from './KycActionButtons'
import ComplianceDocRow from './ComplianceDocRow'
import DocCheck, { DOC_STATUS, reviewLine, type DocFile } from './DocCheck'
import KybSection, { readinessOf } from './KybSection'
import { DOCS, GENERAL, complianceStanding, docStanding, todayIst } from '@controller/lib/catalog/compliance'
import type { ComplianceDocumentRow } from '@controller/lib/catalog/compliance-docs'
import { isGstin, isPan } from '@controller/lib/catalog/tax-ids'

const BORDER: Record<string, string> = {
  pending: 'border-yellow-500/40',
  approved: 'border-green-500/40',
  rejected: 'border-red-500/40',
}

// The store's licences as a whole: one rejected or expired one needs the owner.
const STANDING: StatusMap = {
  action: { label: 'Action needed', tone: 'red' },
  review: { label: 'Waiting for review', tone: 'amber' },
  ok: { label: 'All approved', tone: 'green' },
}

const link = 'text-accent-600 hover:underline text-xs whitespace-nowrap'

/** A stored PAN or GSTIN, flagged when not in its proper shape (older applications let dummies through). */
function TaxId({ value, ok, shape }: { value: string | null; ok: boolean; shape: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Mono>{value || '—'}</Mono>
      {!ok && (
        <span className={badgeCls('amber')} title={`Expected ${shape}`}>
          {value ? 'Invalid format' : 'Missing'}
        </span>
      )}
    </span>
  )
}

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
  kyb = null,
  files = {},
}: {
  tenant: TenantDetail
  kyc: TenantKyc | null
  approvals?: ServiceApproval[]
  /** Licences and certificates submitted with the application (tenant_compliance_documents). */
  documents?: ComplianceDocumentRow[]
  /** The business's KYB (lib/kyb/view.ts); null when it couldn't be loaded. */
  kyb?: KybView | null
  /** Every document on file by id, KYB and licences, with its automatic check. */
  files?: Record<string, DocFile>
}) {
  const store = (t.service_types ?? ['store']).includes('store') || !!t.store_request
  const services = (
    <ServiceApprovals
      tenantId={t.id}
      services={t.service_types ?? []}
      approvals={approvals}
      readiness={kyb ? { messaging: readinessOf(kyb, ['messaging']), documents: readinessOf(kyb, ['documents']) } : undefined}
    />
  )
  const verification = kyb ? (
    <KybSection tenantId={t.id} kyb={kyb} files={files} storeRequest={!!t.store_request} />
  ) : (
    <section className="rounded-xl border border-border-default p-4 sm:p-5 bg-surface-elevated min-w-0">
      <h2 className="font-semibold text-foreground mb-1">Business verification (KYB)</h2>
      <p className="text-sm text-foreground-muted">Couldn’t load the business verification. Reload the page to try again.</p>
    </section>
  )
  if (!kyc) {
    return (
      <div className="space-y-5 sm:space-y-6 min-w-0">
        <Section title="KYC & licences">
          <p className="text-sm text-foreground-muted">This workspace has not submitted KYC details yet.</p>
        </Section>
        {verification}
        {services}
      </div>
    )
  }

  const pending = kyc.status === 'pending'
  const approved = kyc.status === 'approved'
  // Approved as Mandatory, but the Razorpay subscription failed, so there is no link to pay.
  const noPaymentLink =
    approved && store && paymentRequired(t) && !t.razorpay_checkout_url && (t.store_request ? t.store_request === 'awaiting_payment' : t.status === 'awaiting_payment')
  const today = todayIst()
  const standing = complianceStanding(documents, today)
  // What approving switches on, as the approve route gates it: the store, or an API workspace's pending services.
  const gated: KybService[] = store ? ['store'] : approvals.filter(a => a.status === 'pending').map(a => a.service)
  // The business's answers show under Business verification; the old fields stay for when it couldn't be loaded.
  const showFields = !kyb || store || !!kyc.product_categories
  // The GST certificate sent with an older application, before it became a KYB document.
  const legacyGst = !kyb || (!!kyc.gst_cert_s3_key && !kyb.docs.some(d => d.docType === 'gst_cert'))
  const showLicences = store || documents.length > 0 || legacyGst

  return (
    <div className="space-y-5 sm:space-y-6 min-w-0">
    <section className={`rounded-xl border p-4 sm:p-5 bg-surface-elevated min-w-0 ${BORDER[kyc.status] || BORDER.rejected}`}>
      <div className={`flex items-center justify-between flex-wrap gap-3 ${showFields || showLicences ? 'mb-4' : ''}`}>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-semibold text-foreground">KYC & licences</h2>
          <StatusBadge status={kyc.status} map={KYC_STATUS} />
          {t.store_request && <span className={badgeCls('amber')}>Store upgrade</span>}
        </div>

        {pending && <KycActionButtons tenantId={t.id} mode="pending" kyb={kyb ? readinessOf(kyb, gated) : undefined} />}
        {noPaymentLink && <KycActionButtons tenantId={t.id} mode="retry" />}
        {approved && !noPaymentLink && (
          <div className="text-xs text-foreground-muted">
            Approved by {kyc.reviewed_by} on {dateIN(kyc.reviewed_at)}
            {store && ` · payment ${paymentRequired(t) ? 'mandatory' : 'optional'}`}
          </div>
        )}
        {kyc.status === 'rejected' && (
          <div className="text-xs text-red-600 dark:text-red-400 break-words">
            Rejected by {kyc.reviewed_by}: {kyc.reviewer_note}
          </div>
        )}
      </div>

      {showFields && (
        <dl className="grid grid-cols-1 min-[420px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 min-w-0">
          {!kyb && (
            <>
              <Field label="Business name" value={kyc.business_name} />
              <Field label="Business type" value={kyc.business_type} />
              <Field
                label="GSTIN"
                value={kyc.gst_number ? <TaxId value={kyc.gst_number} ok={isGstin(kyc.gst_number)} shape="a 15-character GSTIN like 29ABCDE1234F1Z5" /> : 'Not registered'}
              />
              <Field label="PAN" value={<TaxId value={kyc.pan} ok={isPan(kyc.pan)} shape="5 letters, 4 digits and a letter, like ABCDE1234F" />} />
            </>
          )}
          <Field label="Products" value={kyc.product_categories} />
          {!kyb && kyc.business_address && <Field wide label="Business address" value={kyc.business_address} />}
        </dl>
      )}

      {showLicences && (
      <div className={`${showFields ? 'mt-5 border-t border-border-default pt-4' : ''} min-w-0`}>
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
          {legacyGst && (
            <DocRow
              name="GST registration certificate"
              detail={kyb ? `${GENERAL} · sent with the application` : `${GENERAL} · optional`}
              href={kyc.gst_cert_s3_key ? `/api/admin/ecom/kyc/${t.id}/cert` : undefined}
            />
          )}
          {documents.map(d => {
            const expired = !!d.expires_on && d.expires_on < today
            const name = DOCS[d.doc_type]?.name ?? d.doc_type
            const file = files[d.id]
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
                review={reviewLine({ status: d.status, reviewedAt: d.reviewed_at, reviewedBy: d.reviewed_by, reviewNote: d.review_note })}
                check={file && <DocCheck doc={file} />}
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
        {!documents.length && <p className="mt-2 text-xs text-foreground-muted">{legacyGst ? 'No other licences on file.' : 'No licences on file.'}</p>}
      </div>
      )}
    </section>
    {verification}
    {services}
    </div>
  )
}
