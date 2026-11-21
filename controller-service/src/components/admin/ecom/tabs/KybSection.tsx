import { StatusBadge, type StatusMap } from '@/components/admin/kit/status'
import { docStanding, todayIst } from '@controller/lib/catalog/compliance'
import { ENTITY_TYPES, PAN_HOLDERS } from '@controller/lib/kyb/ids'
import {
  ITEM_LABEL,
  KYB_DOCS,
  MESSAGING_PURPOSES,
  MESSAGING_VOLUMES,
  SERVICE_LABEL,
  type KybItem,
  type KybService,
  type MessagingUse,
} from '@controller/lib/kyb/requirements'
import type { KybView } from '@controller/lib/kyb/view'
import { Field, Mono } from '../EcomUI'
import { dateIN } from '../cells'
import ComplianceDocRow from './ComplianceDocRow'
import DocCheck, { DOC_STATUS, reviewLine, type DocFile } from './DocCheck'
import KybRecheckButton from './KybRecheckButton'
import type { KybReadiness } from './KybGate'

// The KYC tab's Business verification: where each service stands against docs/KYB.md, the business's answers, and
// its KYB documents with their automatic checks.

const SERVICES: KybService[] = ['store', 'messaging', 'documents']

const READINESS: StatusMap = {
  verified: { label: 'Verified', tone: 'green' },
  ready: { label: 'Complete', tone: 'blue' },
  todo: { label: 'Incomplete', tone: 'amber' },
}

const ITEM_STATE: StatusMap = {
  missing: { label: 'Missing', tone: 'red' },
  invalid: { label: 'Needs fixing', tone: 'red' },
  rejected: { label: 'Rejected', tone: 'red' },
  checking: { label: 'Being checked', tone: 'blue' },
  review: { label: 'Waiting for review', tone: 'amber' },
  complete: { label: 'Complete', tone: 'green' },
  approved: { label: 'Verified', tone: 'green' },
  not_needed: { label: 'Not needed', tone: 'muted' },
}

const GST_EXEMPT: Record<string, string> = {
  below_threshold: 'turnover below the GST threshold',
  exempt_supplies: 'sells only exempt goods or services',
  applied: 'has applied for registration',
  other: 'other reason',
}

const H3 = 'text-xs font-semibold uppercase tracking-wide text-foreground-muted'

/** Where the services one approval switches on stand, for the approval buttons. */
export function readinessOf(kyb: KybView, services: KybService[]): KybReadiness | undefined {
  const st = services.map(s => kyb.services[s]).filter(Boolean)
  if (!st.length) return undefined
  const todo = [...new Set(st.flatMap(s => s.todo))]
  return { ready: st.every(s => s.ready), verified: st.every(s => s.verified), todo: todo.map(i => ({ label: ITEM_LABEL[i], problem: kyb.items[i].problem })) }
}

function approvalText(s: KybService, kyb: KybView): string {
  const st = kyb.services[s]
  if (s === 'store') return kyb.status === 'approved' ? 'KYC approved' : kyb.status === 'rejected' ? 'KYC rejected' : kyb.status === 'pending' ? 'KYC waiting for review' : 'No KYC yet'
  if (st.approval === 'pending') return 'Waiting for approval'
  if (st.approval) return st.approval === 'approved' ? 'Approved' : 'Rejected'
  return st.active ? 'Approved before reviews existed' : 'Not requested'
}

function MessagingAnswers({ m }: { m: Partial<MessagingUse> }) {
  const purposes = (m.purposes ?? []).map(id => MESSAGING_PURPOSES.find(p => p.id === id)?.label ?? id)
  const volume = MESSAGING_VOLUMES.find(v => v.id === m.volume)?.label
  return (
    <div className="col-span-full min-w-0">
      <dt className="text-xs text-foreground-muted">How they will message people</dt>
      <dd className="mt-0.5 space-y-1 text-sm text-foreground min-w-0 break-words">
        <p>
          {purposes.length ? purposes.join(', ') : '-'}
          {volume && <span className="text-foreground-muted"> · {volume}</span>}
        </p>
        {m.optIn && (
          <p className="text-xs whitespace-pre-line">
            <span className="text-foreground-muted">How people opt in: </span>
            {m.optIn}
          </p>
        )}
        {m.sample && (
          <p className="text-xs whitespace-pre-line">
            <span className="text-foreground-muted">Sample message: </span>
            {m.sample}
          </p>
        )}
        <p className="text-xs text-foreground-muted">
          {m.acceptedAt ? `Accepted the messaging policy (version ${m.policyVersion ?? '-'}) on ${dateIN(m.acceptedAt)}.` : 'Hasn’t accepted the messaging policy.'}
        </p>
      </dd>
    </div>
  )
}

function Answers({ kyb, messaging }: { kyb: KybView; messaging: boolean }) {
  const p = kyb.profile
  const address = [p.addressLine, p.city, [p.state, p.pincode].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  const holder = p.pan ? PAN_HOLDERS[p.pan[3]] : undefined
  const gst =
    p.gstRegistered === true ? (
      p.gstin ? <Mono>{p.gstin}</Mono> : 'Registered, no GSTIN given'
    ) : p.gstRegistered === false ? (
      <>
        Not registered{p.gstExemptReason ? `: ${GST_EXEMPT[p.gstExemptReason] ?? p.gstExemptReason}` : ''}
        {p.gstExemptNote && <span className="block text-xs text-foreground-muted whitespace-pre-line">{p.gstExemptNote}</span>}
      </>
    ) : (
      'Not answered'
    )
  // Only http(s) addresses become links: the owner typed it.
  const website = p.website ? (
    /^https?:\/\//i.test(p.website) ? (
      <a href={p.website} target="_blank" rel="noopener noreferrer nofollow" className="text-accent-600 hover:underline break-all">
        {p.website}
      </a>
    ) : (
      p.website
    )
  ) : null

  return (
    <dl className="mt-3 grid grid-cols-1 min-[420px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 min-w-0">
      <Field label="Legal name" value={p.legalName} />
      {p.tradeName && <Field label="Trade name" value={p.tradeName} />}
      <Field label="Business type" value={ENTITY_TYPES.find(e => e.id === p.entityType)?.label ?? p.entityType} />
      <Field
        label="PAN"
        value={
          p.pan ? (
            <>
              <Mono>{p.pan}</Mono>
              {holder && <span className="block text-xs text-foreground-muted">Issued to {holder}</span>}
            </>
          ) : null
        }
      />
      <Field label="GST" value={gst} />
      <Field label="Authorised signatory" value={p.authorizedName ? `${p.authorizedName}${p.authorizedDesignation ? `, ${p.authorizedDesignation}` : ''}` : null} />
      {p.mobile && <Field label="Mobile" value={p.mobile} />}
      {(p.website || messaging) && <Field label="Website" value={website} />}
      <Field wide label="Address" value={address || null} />
      {p.messagingUse && <MessagingAnswers m={p.messagingUse} />}
    </dl>
  )
}

const DOC_ORDER = Object.keys(KYB_DOCS)
const docRank = (t: string) => (DOC_ORDER.includes(t) ? DOC_ORDER.indexOf(t) : DOC_ORDER.length)

export default function KybSection({
  tenantId,
  kyb,
  files,
  storeRequest,
}: {
  tenantId: string
  kyb: KybView
  /** Every document on file by id, KYB and licences. */
  files: Record<string, DocFile>
  /** An API workspace applying for a store: the store's KYB counts. */
  storeRequest: boolean
}) {
  const today = todayIst()
  const shown = SERVICES.filter(s => kyb.services[s].active || kyb.services[s].approval != null || (s === 'store' && storeRequest))
  const items = (Object.keys(ITEM_LABEL) as KybItem[]).filter(i => shown.some(s => kyb.services[s].required.includes(i)))
  const checking = Object.values(files).filter(f => f.analysisStatus === 'pending').length
  const docs = [...kyb.docs].sort((a, b) => docRank(a.docType) - docRank(b.docType))

  return (
    <section className="rounded-xl border border-border-default p-4 sm:p-5 bg-surface-elevated min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
        <h2 className="font-semibold text-foreground">Business verification (KYB)</h2>
        <KybRecheckButton tenantId={tenantId} checking={checking} />
      </div>
      <p className="text-xs text-foreground-muted mb-4">
        What each service needs verified before it is approved. Every document is read automatically and compared with the answers; the check only
        advises, so approve or reject each document yourself.
      </p>

      {shown.length ? (
        <div className="grid gap-x-8 gap-y-5 lg:grid-cols-2 min-w-0">
          <div className="min-w-0">
            <h3 className={H3}>Services</h3>
            <ul className="mt-1 divide-y divide-border-default">
              {shown.map(s => {
                const st = kyb.services[s]
                const state = st.verified ? 'verified' : st.ready ? 'ready' : 'todo'
                return (
                  <li key={s} className="py-2.5 min-w-0">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-sm font-medium text-foreground">{SERVICE_LABEL[s]}</span>
                      <StatusBadge status={state} map={READINESS} label={state === 'todo' ? `${st.todo.length} to do` : undefined} />
                      <span className="text-xs text-foreground-muted">{approvalText(s, kyb)}</span>
                    </div>
                    {st.todo.length > 0 && <p className="mt-0.5 text-xs text-foreground-muted break-words">To do: {st.todo.map(i => ITEM_LABEL[i]).join(', ')}</p>}
                  </li>
                )
              })}
            </ul>
          </div>
          <div className="min-w-0">
            <h3 className={H3}>Checklist</h3>
            <ul className="mt-1 divide-y divide-border-default">
              {items.map(i => (
                <li key={i} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 py-2.5 min-w-0">
                  <div className="min-w-0 flex-1 basis-48">
                    <div className="text-sm text-foreground">{ITEM_LABEL[i]}</div>
                    {kyb.items[i].problem && <div className="text-xs text-foreground-muted break-words">{kyb.items[i].problem}</div>}
                  </div>
                  <StatusBadge status={kyb.items[i].state} map={ITEM_STATE} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <p className="text-sm text-foreground-muted">A showcase site needs nothing verified.</p>
      )}

      <div className="mt-5 border-t border-border-default pt-4 min-w-0">
        <h3 className={H3}>Answers</h3>
        <Answers kyb={kyb} messaging={shown.includes('messaging')} />
      </div>

      <div className="mt-5 border-t border-border-default pt-4 min-w-0">
        <h3 className={H3}>Documents</h3>
        {docs.length ? (
          <ul className="mt-1 divide-y divide-border-default min-w-0">
            {docs.map(d => {
              const f = files[d.id]
              const expired = !!d.expiresOn && d.expiresOn < today
              return (
                <ComplianceDocRow
                  key={d.id}
                  tenantId={tenantId}
                  docId={d.id}
                  version={f?.version}
                  name={d.label}
                  pending={d.status === 'pending'}
                  lapsed={expired}
                  badge={<StatusBadge status={docStanding({ status: d.status, expires_on: d.expiresOn }, today)} map={DOC_STATUS} />}
                  href={`/api/admin/ecom/kyc/${tenantId}/doc/${d.id}`}
                  review={reviewLine({ ...d, reviewedBy: f?.reviewedBy ?? null, reviewedAt: f?.reviewedAt ?? null })}
                  check={<DocCheck doc={d} />}
                  detail={
                    <>
                      {d.number && (
                        <>
                          <Mono>{d.number}</Mono>
                          {' · '}
                        </>
                      )}
                      {d.expiresOn && (
                        <span className={expired ? 'text-red-600 dark:text-red-400' : undefined}>
                          {expired ? 'expired' : 'expires'} {dateIN(d.expiresOn)}
                          {' · '}
                        </span>
                      )}
                      sent {dateIN(d.uploadedAt)}
                    </>
                  }
                />
              )
            })}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-foreground-muted">No KYB documents uploaded yet.</p>
        )}
      </div>
    </section>
  )
}
