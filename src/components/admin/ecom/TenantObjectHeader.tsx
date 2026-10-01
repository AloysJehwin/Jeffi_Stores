import Link from 'next/link'
import type { TenantDetail, ProvisioningJob } from '@/lib/tenant-registry'
import { StatusPill } from './EcomUI'
import TenantActions from './TenantActions'

/**
 * Shared header for the three tenant object pages (customers, instances, store-status).
 * Each lives under its own list's path prefix because the sidebar marks a group active with
 * startsWith(href + '/') — an object page off that prefix would never expand its nav group.
 */
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
  return (
    <>
      <Link href={backHref} className="text-sm text-accent-600 dark:text-accent-400 hover:underline">
        ← {backLabel}
      </Link>

      <div className="mt-3 mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-foreground truncate">{t.display_name}</h1>
            <StatusPill status={t.status} />
            {kycPending && (
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
                KYC pending review
              </span>
            )}
          </div>
          <p className="text-sm text-foreground-muted mt-1 break-all">{t.slug}.jeffistores.in</p>
        </div>

        <div className="shrink-0">
          <TenantActions
            tenantId={t.id}
            slug={t.slug}
            status={t.status}
            instanceState={t.instance_state}
            jobStatus={job?.status ?? null}
            jobStep={job?.step ?? null}
            rolledBack={(job?.created_resources as Record<string, unknown> | null)?.rolledBack === true}
          />
        </div>
      </div>

      {related && related.length > 0 && (
        <nav className="mb-5 flex flex-wrap items-center gap-2">
          {related.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="px-3 py-1.5 rounded-lg border border-border-default text-sm font-medium text-foreground hover:bg-surface-secondary transition-colors"
            >
              {label}
            </Link>
          ))}
        </nav>
      )}
    </>
  )
}
