import Link from 'next/link'
import { loadOwnerContext } from '@controller/lib/ecom/owner-context'
import ConsoleShell from './ConsoleShell'
import { hasService, listServiceApprovals } from '@/lib/tenant-registry'
import { computeSpecEnabled } from '@controller/lib/compute/catalog'
import { complianceAttention } from '@controller/lib/catalog/compliance-docs'
import { kybUnready } from '@controller/lib/ecom/service-states'
import { listLines } from '@controller/lib/billing/lines'
import { REVIEW_TIME } from '@controller/lib/ecom/console-copy'

export const dynamic = 'force-dynamic'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { owner, tenants, tenant } = await loadOwnerContext()
  const billingLines = listLines(tenant.id).catch(() => [])
  const review = (await listServiceApprovals(tenant.id).catch(() => [])).filter(a => a.status !== 'approved')
  // Jeffi can't approve a service until its business verification is complete.
  const unverified = await kybUnready(tenant, owner.id, review.map(r => r.service))
  const verify = (s: (typeof unverified)[number]) =>
    unverified.includes(s) && (
      <>
        {' '}
        <Link href={`/dashboard/business?for=${s}`} className="font-semibold underline underline-offset-2">
          Verify your business
        </Link>
      </>
    )
  // A rejected or expired licence puts the store's compliance in need of action (dashboard/licences).
  const licences = hasService(tenant, 'store') ? await complianceAttention(tenant.id).catch(() => null) : null
  // Wallet-paid items still to move onto the subscription (/dashboard/billing/subscribe), and the earliest deadline.
  const legacy = (await billingLines).filter(l => l.status === 'legacy_wallet')
  const deadline = legacy.map(l => l.graceUntil).filter((d): d is string => !!d).sort()[0]
  const label = (s: string) => (s === 'messaging' ? 'Messaging' : 'Documents')
  const lite = (t: typeof tenant) => ({ slug: t.slug, display_name: t.display_name, status: t.status, service_types: t.service_types ?? ['store'] })
  return (
    <div>
      <ConsoleShell owner={{ email: owner.email, name: owner.name }} tenants={tenants.map(lite)} current={lite(tenant)} flags={computeSpecEnabled() ? ['compute'] : []}>
        {review.length > 0 && (
          <div className={`mb-6 rounded-2xl px-5 py-3 text-sm ${review.some(r => r.status === 'rejected') ? 'bg-[#f6d5cc]/60 text-[#8a2e1f]' : 'org-peach'}`}>
            {review.map(r => r.status === 'pending'
              ? <p key={r.service}><strong>{label(r.service)} API is under review.</strong> {verify(r.service) ? 'We can approve it once your business is verified.' : `Explore the console, set up templates and create API keys — sending starts once we approve it (usually within ${REVIEW_TIME}).`}{verify(r.service)}</p>
              : <p key={r.service}><strong>{label(r.service)} API was not approved.</strong> {r.note ? `${r.note} — ` : ''}{verify(r.service) ? 'complete your business verification, then request it again.' : 'reply to our email or write to support@jeffistores.in.'}{verify(r.service)}</p>)}
          </div>
        )}
        {licences === 'action' && (
          <div className="mb-6 rounded-2xl px-5 py-3 text-sm bg-[#f6d5cc]/60 text-[#8a2e1f]">
            <strong>A licence needs your attention.</strong> One was not accepted or has expired.{' '}
            <Link href="/dashboard/licences" className="font-semibold underline underline-offset-2">
              Send a new copy
            </Link>
          </div>
        )}
        {legacy.length > 0 && (
          <div className="mb-6 rounded-2xl px-5 py-3 text-sm org-peach">
            <strong>Monthly charges are moving to one subscription</strong> —{' '}
            <Link href={`/dashboard/billing/subscribe?tenant=${encodeURIComponent(tenant.slug)}`} className="font-semibold underline underline-offset-2">
              set it up{deadline ? ` by ${new Date(deadline).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}` : ''}
            </Link>
          </div>
        )}
        {children}
      </ConsoleShell>
    </div>
  )
}
