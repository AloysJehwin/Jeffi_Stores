import type { TenantSocialAccount, IntegrationCredential } from '@/lib/tenant-registry'
import { Section } from '../EcomUI'

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

/** The store's connected accounts. Admin certificates have their own tab (CertificatesTab). */
export default function AccessTab({ social, integrations }: { social: TenantSocialAccount[]; integrations: Integration[] }) {
  return (
    <div className="space-y-5 sm:space-y-6 min-w-0">
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
