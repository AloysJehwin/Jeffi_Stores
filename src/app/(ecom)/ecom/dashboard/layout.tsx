import { loadOwnerContext } from '@/lib/ecom/owner-context'
import ConsoleShell from './ConsoleShell'
import { listServiceApprovals } from '@/lib/tenant-registry'

export const dynamic = 'force-dynamic'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { owner, tenants, tenant } = await loadOwnerContext()
  const review = (await listServiceApprovals(tenant.id).catch(() => [])).filter(a => a.status !== 'approved')
  const label = (s: string) => (s === 'messaging' ? 'Messaging' : 'Documents')
  const lite = (t: typeof tenant) => ({ slug: t.slug, display_name: t.display_name, status: t.status, service_types: t.service_types ?? ['store'] })
  return (
    <div>
      <ConsoleShell owner={{ email: owner.email, name: owner.name }} tenants={tenants.map(lite)} current={lite(tenant)}>
        {review.length > 0 && (
          <div className={`mb-6 rounded-2xl px-5 py-3 text-sm ${review.some(r => r.status === 'rejected') ? 'bg-[#f6d5cc]/60 text-[#8a2e1f]' : 'org-peach'}`}>
            {review.map(r => r.status === 'pending'
              ? <p key={r.service}><strong>{label(r.service)} API is under review.</strong> Explore the console, set up templates and create API keys — sending starts once we approve it (usually the same business day).</p>
              : <p key={r.service}><strong>{label(r.service)} API was not approved.</strong> {r.note ? `${r.note} — ` : ''}reply to our email or write to support@jeffistores.in.</p>)}
          </div>
        )}
        {children}
      </ConsoleShell>
    </div>
  )
}
