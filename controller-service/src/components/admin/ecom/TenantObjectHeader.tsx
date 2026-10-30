import Link from 'next/link'
import type { TenantDetail, ProvisioningJob } from '@/lib/tenant-registry'
import { StatusPill } from './EcomUI'
import TenantActions from './TenantActions'
import { hasService } from '@/lib/tenant-registry'
import { PageHeader } from '@/components/admin/kit/layout'
import { badgeCls } from '@/components/admin/kit/tones'

/**
 * Shared header for the three tenant object pages (customers, instances, store-status).
 * Each lives under its own list's path prefix because the sidebar marks a group active with
 * startsWith(href + '/') — an object page off that prefix would never expand its nav group.
 */
export const apiServices = (t: { service_types?: string[] | null }) =>
  (t.service_types ?? []).filter(s => s !== 'store').map(s => (s === 'messaging' ? 'Messaging' : 'Documents')).join(' + ') || 'no services'

export default function TenantObjectHeader({
  tenant: t,
  backHref,
  backLabel,
  kycPending,
  related,
  job,
}: {
  tenant: TenantDetail
  backHref: string
  backLabel: string
  kycPending?: boolean
  related?: { href: string; label: string }[]
  job?: ProvisioningJob | null
}) {
  const isStore = hasService(t, 'store')
  return (
    <>
      <PageHeader
        back={{ href: backHref, label: backLabel }}
        title={<span className="break-words">{t.display_name}</span>}
        badges={
          <>
            <StatusPill status={t.status} />
            {kycPending && <span className={badgeCls('amber')}>KYC pending review</span>}
          </>
        }
        description={<span className="break-all">{isStore ? `${t.slug}.jeffistores.in` : `API workspace · ${apiServices(t)} · no store`}</span>}
        actions={
          // Deprovision / backup / instance actions only exist for a store.
          isStore ? (
            <TenantActions
              tenantId={t.id}
              slug={t.slug}
              status={t.status}
              instanceState={t.instance_state}
              jobStatus={job?.status ?? null}
              jobStep={job?.step ?? null}
              rolledBack={(job?.created_resources as Record<string, unknown> | null)?.rolledBack === true}
            />
          ) : undefined
        }
      />

      {related && related.length > 0 && (
        <nav className="flex flex-wrap items-center gap-2">
          {related.map(({ href, label }) => (
            <Link key={href} href={href} className="control-md border border-border-default bg-surface-elevated font-medium text-foreground hover:bg-surface-secondary transition-colors">
              {label}
            </Link>
          ))}
        </nav>
      )}
    </>
  )
}
