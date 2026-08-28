import type { TenantDetail, TenantSocialAccount, IntegrationCredential } from '@/lib/tenant-registry'
import type { AdminCertRow } from '@/lib/tenant-ca'
import { Field, FieldGrid, Mono, Section } from '../EcomUI'

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
  const cls = d < 0 ? 'text-red-600 dark:text-red-400'
    : d < 30 ? 'text-amber-600 dark:text-amber-400'
    : 'text-foreground'
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
  tenant: t, certs, ca, social, integrations,
}: {
  tenant: TenantDetail
  certs: AdminCertRow[]
  ca: { subject: string; expiresAt: Date } | null
  social: TenantSocialAccount[]
  integrations: Integration[]
}) {
  const active = certs.filter(c => !c.revoked_at && new Date(c.expires_at) > new Date())

  return (
    <div className="space-y-6 min-w-0">
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
          <div className="overflow-x-auto -mx-5 px-5">
            <table className="w-full text-sm min-w-[36rem]">
              <thead className="text-foreground-muted">
                <tr className="text-left border-b border-border-default">
                  <th className="pb-2 font-medium">Holder</th>
                  <th className="pb-2 font-medium">Serial</th>
                  <th className="pb-2 font-medium">Issued</th>
                  <th className="pb-2 font-medium">Expires</th>
                  <th className="pb-2 font-medium">State</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {certs.map((c) => {
                  const revoked = !!c.revoked_at
                  const expired = new Date(c.expires_at) <= new Date()
                  return (
                    <tr key={c.id}>
                      <td className="py-2.5 min-w-0">
                        <div className="text-foreground break-all">{c.common_name}</div>
                        {c.issued_to && c.issued_to !== c.common_name && (
                          <div className="text-xs text-foreground-muted break-all">{c.issued_to}</div>
                        )}
                      </td>
                      <td className="py-2.5"><Mono>{c.serial.slice(0, 16)}…</Mono></td>
                      <td className="py-2.5 text-foreground-muted text-xs">{new Date(c.issued_at).toLocaleDateString('en-IN')}</td>
                      <td className="py-2.5 text-xs"><Expiry at={c.expires_at} /></td>
                      <td className="py-2.5">
                        {revoked ? (
                          <span className="text-xs text-red-600 dark:text-red-400">
                            revoked{c.revoked_by ? ` by ${c.revoked_by}` : ''}
                          </span>
                        ) : expired ? (
                          <span className="text-xs text-foreground-muted">expired</span>
                        ) : (
                          <span className="text-xs text-green-600 dark:text-green-400">active</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section title="Social accounts">
          {social.length === 0 ? (
            <Empty>No Meta account connected.</Empty>
          ) : (
            <ul className="space-y-3">
              {social.map((s) => (
                <li key={s.id} className="flex items-start justify-between gap-3 min-w-0">
                  <div className="min-w-0">
                    <div className="text-sm text-foreground capitalize">{s.provider}</div>
                    <div className="text-xs text-foreground-muted break-all">{s.page_name || s.page_id || s.ig_user_id || '—'}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs capitalize text-foreground-muted">{s.status}</div>
                    <div className="text-xs"><Expiry at={s.token_expiry} /></div>
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
              {integrations.map((i) => (
                <li key={i.id} className="flex items-start justify-between gap-3 min-w-0">
                  <div className="min-w-0">
                    <div className="text-sm text-foreground">{i.label || i.provider}</div>
                    <div className="text-xs text-foreground-muted break-all">{i.provider}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs capitalize text-foreground-muted">{i.status}</div>
                    <div className="text-xs"><Expiry at={i.expires_at} /></div>
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
