'use client'

import Link from 'next/link'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { SHOWCASE_HOST_PREFIX, type ShowcaseStatus } from '@/lib/showcase/types'
import PageHeader from '../../../_components/PageHeader'
import DomainPurchase from '../../../DomainPurchase'
import CustomDomains from '../../../CustomDomains'

const secondary =
  'inline-flex items-center justify-center gap-1.5 rounded-full border border-border-default px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-surface-secondary'

function Address({ host }: { host: string }) {
  return (
    <a href={`https://${host}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-center gap-1 break-all font-mono text-foreground underline-offset-2 hover:underline">
      {host} <ExternalLink className="h-3.5 w-3.5 shrink-0" />
    </a>
  )
}

/** One Showcase's domain: where it answers now, then buying one (the store's flow) or connecting one the owner has. */
export default function DomainClient({
  siteId,
  slug,
  name,
  host,
  customDomain,
  status,
  workspace,
  tenantSlug,
}: {
  siteId: string
  slug: string
  name: string
  host: string
  customDomain: string | null
  status: ShowcaseStatus
  workspace: { id: string; slug: string } | null
  tenantSlug: string
}) {
  const t = `?tenant=${encodeURIComponent(tenantSlug)}`
  return (
    <>
      <PageHeader
        eyebrow="Showcase domain"
        title={name}
        description={`Give ${host} a domain of its own: buy one here, or connect one you already have. One domain per site.`}
        actions={
          <Link href={`/dashboard/showcase${t}`} className={secondary}>
            <ArrowLeft className="h-4 w-4" /> Sites
          </Link>
        }
      />

      <div className="space-y-6">
        <section className="rounded-2xl border border-border-default bg-surface-elevated p-6 text-sm">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-foreground-muted">Address</h2>
          {customDomain ? (
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-foreground-secondary">Live on</span> <Address host={customDomain} />
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-foreground-muted">
                Still reachable at <Address host={host} />
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-foreground-secondary">Your site is at</span> <Address host={host} />
            </div>
          )}
          {status !== 'live' && (
            <p className="mt-3 rounded-xl org-peach px-4 py-3 text-foreground">
              {status === 'draft' ? 'This site is not published yet: visitors see it on its domain once you publish it.' : 'This site is paused: its domain shows it offline until it is live again.'}
            </p>
          )}
        </section>

        {workspace ? (
          <>
            <DomainPurchase tenantId={workspace.id} tenantSlug={workspace.slug} siteId={siteId} />
            <CustomDomains tenantId={workspace.id} slug={`${SHOWCASE_HOST_PREFIX}${slug}`} maxDomains={1} siteId={siteId} />
          </>
        ) : (
          <section className="rounded-2xl border border-border-default bg-surface-elevated p-6 text-sm text-foreground-secondary">
            Publish the site first. Its domain is paid from the wallet of the workspace its first publish sets up.
          </section>
        )}
      </div>
    </>
  )
}
