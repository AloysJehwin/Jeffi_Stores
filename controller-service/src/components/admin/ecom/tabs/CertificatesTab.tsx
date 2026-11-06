import type { TenantDetail } from '@/lib/tenant-registry'
import type { AdminCertRow } from '@/lib/tenancy/tenant-ca'
import { StatusBadge, type StatusMap } from '@/components/admin/kit'
import { Field, FieldGrid, Mono, Section } from '../EcomUI'
import CertsTable from '../detail/CertsTable'
import IssueCertButton from '../detail/IssueCertButton'

const OWNER_CERT: StatusMap = {
  active: { label: 'Active', tone: 'green' },
  expired: { label: 'Expired', tone: 'amber' },
  revoked: { label: 'Revoked', tone: 'red' },
  missing: { label: 'Not issued', tone: 'muted' },
}

const isActive = (c: AdminCertRow) => !c.revoked_at && new Date(c.expires_at) > new Date()

function ownerCertState(certs: AdminCertRow[], email: string | null): keyof typeof OWNER_CERT {
  if (!email) return 'missing'
  const e = email.toLowerCase()
  const mine = certs.filter(c => (c.issued_to ?? c.common_name).toLowerCase() === e)
  if (mine.some(isActive)) return 'active'
  if (!mine.length) return 'missing'
  return mine.some(c => !c.revoked_at) ? 'expired' : 'revoked'
}

function Expiry({ at }: { at: Date }) {
  const d = Math.floor((new Date(at).getTime() - Date.now()) / 86_400_000)
  const cls = d < 0 ? 'text-red-600 dark:text-red-400' : d < 30 ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'
  return (
    <span className={cls}>
      {new Date(at).toLocaleDateString('en-IN')}
      <span className="text-xs ml-1.5">{d < 0 ? `expired ${-d}d ago` : `${d}d left`}</span>
    </span>
  )
}

/** The store's admin access: the owner's certificate, the store's CA and every client certificate it issued. */
export default function CertificatesTab({
  tenant: t,
  certs,
  ca,
  ownerEmail,
}: {
  tenant: TenantDetail
  certs: AdminCertRow[]
  ca: { subject: string; expiresAt: Date } | null
  ownerEmail: string | null
}) {
  const active = certs.filter(isActive)
  const state = ownerCertState(certs, ownerEmail)
  const canIssue = !!t.rds_endpoint

  return (
    <div className="space-y-5 sm:space-y-6 min-w-0">
      <Section
        title="Owner access"
        action={canIssue ? <IssueCertButton tenantId={t.id} ownerEmail={ownerEmail} hasActive={state === 'active'} /> : undefined}
      >
        <FieldGrid>
          <Field label="Owner" value={ownerEmail ? <span className="break-all">{ownerEmail}</span> : <span className="text-foreground-muted">No owner linked</span>} />
          <Field label="Owner certificate" value={<StatusBadge status={state} map={OWNER_CERT} />} />
        </FieldGrid>
        {!canIssue && <p className="mt-3 text-sm text-foreground-muted">Certificates can be issued once the store has its database.</p>}
      </Section>

      <Section title="Admin certificate authority">
        {!ca ? (
          <p className="text-sm text-foreground-muted">
            No CA issued for this tenant yet. It is created with the first certificate — until then
            <span className="font-mono text-xs"> admin-{t.slug}.jeffistores.in</span> cannot accept client certificates.
          </p>
        ) : (
          <FieldGrid>
            <Field wide label="Subject" value={<Mono>{ca.subject}</Mono>} />
            <Field label="Expires" value={<Expiry at={ca.expiresAt} />} />
            <Field label="Active certificates" value={`${active.length} of ${certs.length}`} />
          </FieldGrid>
        )}
      </Section>

      <Section title="Admin client certificates">
        {certs.length === 0 ? (
          <p className="text-sm text-foreground-muted">No client certificates issued. Nobody can reach this store&apos;s admin panel over mTLS.</p>
        ) : (
          <CertsTable tenantId={t.id} certs={certs} />
        )}
      </Section>
    </div>
  )
}
