import Link from 'next/link'
import { BarChart3, CreditCard, ExternalLink, Globe, Inbox, Pencil } from 'lucide-react'
import type { ShowcaseConsoleState } from '@controller/lib/showcase/state'
import { hostingView, type HostingKind } from '@controller/lib/showcase/hosting'
import HostText from '../_components/HostText'

const link = 'inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors'
const primary = `${link} ecom-accent-bg text-white`
const secondary = `${link} border border-border-default text-foreground hover:bg-surface-secondary`

function siteBadge(s: ShowcaseConsoleState): [string, string] {
  if (s.status === 'draft') return ['Draft', 'org-sand text-foreground-secondary']
  if (s.status === 'paused') return [s.pauseReason === 'unpaid' ? 'Offline · unpaid' : 'Paused by you', 'org-peach text-foreground']
  return ['Live', 'bg-[var(--console-sage)] text-[var(--console-sage-deep)]']
}

/** The one hosting step a site's row offers, when it needs the owner. */
const NEXT: Partial<Record<HostingKind, string>> = { trial: 'Set up autopay', approve: 'Approve autopay', lapsed: 'Keep it online', halted: 'Keep it online', legacy: 'Move to subscription' }

/** The owner's Showcase sites, newest first, each with its pages. */
export default function SitesList({ sites, tenantSlug }: { sites: ShowcaseConsoleState[]; tenantSlug: string }) {
  const t = `?tenant=${encodeURIComponent(tenantSlug)}`
  return (
    <ul className="space-y-4">
      {sites.map(s => {
        const base = `/dashboard/showcase/${s.id}`
        const [label, cls] = siteBadge(s)
        const hosting = hostingView(s)
        const next = NEXT[hosting.kind]
        const nextHref = hosting.kind === 'approve' && s.checkoutUrl ? s.checkoutUrl : hosting.kind === 'legacy' ? `/dashboard/billing/subscribe${t}` : `${base}${t}`
        return (
          <li key={s.id} className="rounded-2xl border border-border-default bg-surface-elevated p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="break-words font-display text-xl font-black text-foreground">
                  <Link href={`${base}${t}`} className="hover:underline">
                    {s.name}
                  </Link>
                </h2>
                <a
                  href={s.previewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex max-w-full items-center gap-1 font-mono text-sm text-foreground-secondary hover:text-foreground"
                >
                  <HostText host={s.host} className="min-w-0" /> <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                </a>
                {s.status !== 'draft' && (
                  <p className="mt-1.5 text-sm">
                    <span className={hosting.tone === 'warn' ? 'font-semibold text-[#8a2e1f]' : 'font-semibold text-foreground'}>{hosting.label}</span>
                    {hosting.detail && <span className="text-foreground-secondary"> · {hosting.detail}</span>}
                  </p>
                )}
              </div>
              <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}>{label}</span>
            </div>

            <div className="mt-4 flex flex-wrap gap-2 border-t border-border-default pt-4">
              {next && (
                <Link href={nextHref} className={primary}>
                  <CreditCard className="h-4 w-4" /> {next}
                </Link>
              )}
              {s.status === 'draft' ? (
                <Link href={`/onboard/showcase?site=${s.id}`} className={primary}>
                  <Pencil className="h-4 w-4" /> Continue setting up
                </Link>
              ) : (
                <Link href={`${base}/edit${t}`} className={next ? secondary : primary}>
                  <Pencil className="h-4 w-4" /> Edit
                </Link>
              )}
              <Link href={`${base}/leads${t}`} className={secondary}>
                <Inbox className="h-4 w-4" /> Enquiries
                {s.unreadLeads > 0 && <span className="rounded-full ecom-accent-bg px-2 py-0.5 text-xs font-semibold text-white">{s.unreadLeads} new</span>}
              </Link>
              <Link href={`${base}/analytics${t}`} className={secondary}>
                <BarChart3 className="h-4 w-4" /> Analytics
              </Link>
              <Link href={`${base}/domain${t}`} className={secondary}>
                <Globe className="h-4 w-4" /> Domain
              </Link>
              <Link href={`${base}${t}`} className={secondary}>
                <CreditCard className="h-4 w-4" /> Hosting
              </Link>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
