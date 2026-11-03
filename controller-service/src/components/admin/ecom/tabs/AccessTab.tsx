import type { TenantDetail, TenantSocialAccount, IntegrationCredential } from '@/lib/tenant-registry'
import type { AdminCertRow } from '@/lib/tenancy/tenant-ca'
import { Field, FieldGrid, Mono, Section } from '../EcomUI'
import CertsTable from '../detail/CertsTable'

type Integration = Omit<IntegrationCredential, 'config_enc'>

/** Days until `when`, negative once past. */
function daysUntil(when: string | Date | null): number | null {
  if (!when) return null
  const ms = new Date(when).getTime() - Date.now()
  return Math.floor(ms / 86_400_000)
}

function Expiry({ at }: { at: string | Date | null }) {
  const d = daysUntil(at)
  if (d === null) return <span className="text-foreground-muted">—</span>
  const cls =
    d < 0 ? 'text-red-600 dark:text-red-400' : d < 30 ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'
  return (
    <span className={cls}>
      {new Date(at!).toLocaleDateString('en-IN')}
      <span className="text-xs ml-1.5">{d < 0 ? `expired ${-d}d ago` : `${d}d left`}</span>
    </span>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-foreground-muted">{children}</p>
}

export default function AccessTab({
  tenant: t,
  certs,
  ca,
  social,
  integrations,
}: {
  tenant: TenantDetail
  certs: AdminCertRow[]
  ca: { subject: string; expiresAt: Date } | null
  social: TenantSocialAccount[]
  integrations: Integration[]
}) {
  const active = certs.filter(c => !c.revoked_at && new Date(c.expires_at) > new Date())

  return (
    <div className="space-y-5 sm:space-y-6 min-w-0">
      <Section title="Admin certificate authority">
        {!ca ? (
          <Empty>
            No CA issued for this tenant yet. It is created during provisioning — until then
            <span className="font-mono text-xs"> admin-{t.slug}.jeffistores.in</span> cannot accept client certificates.
          </Empty>
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
          <Empty>No client certificates issued. Nobody can reach this store&apos;s admin panel over mTLS.</Empty>
        ) : (
          <CertsTable tenantId={t.id} certs={certs} />
        )}
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-6">
        <Section title="Social accounts">
          {social.length === 0 ? (
            <Empty>No Meta account connected.</Empty>
          ) : (
            <ul className="space-y-3">
              {social.map(s => (
                <li key={s.id} className="flex items-start justify-between gap-3 min-w-0">
                  <div className="min-w-0">
                    <div className="text-sm text-foreground capitalize">{s.provider}</div>
                    <div className="text-xs text-foreground-muted break-all">
                      {s.page_name || s.page_id || s.ig_user_id || '—'}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs capitalize text-foreground-muted">{s.status}</div>
                    <div className="text-xs">
                      <Expiry at={s.token_expiry} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Integrations">
          {integrations.length === 0 ? (
            <Empty>No integrations configured.</Empty>
          ) : (
            <ul className="space-y-3">
              {integrations.map(i => (
                <li key={i.id} className="flex items-start justify-between gap-3 min-w-0">
                  <div className="min-w-0">
                    <div className="text-sm text-foreground">{i.label || i.provider}</div>
                    <div className="text-xs text-foreground-muted break-all">{i.provider}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs capitalize text-foreground-muted">{i.status}</div>
                    <div className="text-xs">
                      <Expiry at={i.expires_at} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  )
}
