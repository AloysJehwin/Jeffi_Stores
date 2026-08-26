import { headers } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { isPlatformAdmin } from '@/lib/scopes'
import { getTenant } from '@/lib/tenant-registry'
import { StatusPill } from '@/components/admin/ecom/EcomUI'
import ProvisioningLogsClient from '@/components/admin/ecom/ProvisioningLogsClient'

export const dynamic = 'force-dynamic'

export default async function ProvisioningDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const h = await headers()
  const role = h.get('x-user-role') || ''
  if (!isPlatformAdmin(role)) redirect('/admin')

  const { id } = await params
  const t = await getTenant(id)
  if (!t) notFound()

  return (
    <div className="p-6 w-full max-w-full min-w-0 overflow-x-hidden">
      <Link href="/admin/ecom/provisioning" className="text-sm text-accent-600 dark:text-accent-400 hover:underline">
        ← Provisioning
      </Link>

      <div className="mt-3 mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-foreground truncate">{t.display_name}</h1>
            <StatusPill status={t.status} />
          </div>
          <p className="text-sm text-foreground-muted mt-1 break-all">{t.slug}.jeffistores.in</p>
        </div>

        <nav className="flex items-center gap-2 shrink-0">
          <Link href={`/admin/ecom/customers/${t.id}`} className="px-3 py-1.5 rounded-lg border border-border-default text-sm font-medium text-foreground hover:bg-surface-secondary transition-colors">
            Customer
          </Link>
          <Link href={`/admin/ecom/instances/${t.id}`} className="px-3 py-1.5 rounded-lg border border-border-default text-sm font-medium text-foreground hover:bg-surface-secondary transition-colors">
            Instance
          </Link>
          <Link href={`/admin/ecom/store-status/${t.id}`} className="px-3 py-1.5 rounded-lg border border-border-default text-sm font-medium text-foreground hover:bg-surface-secondary transition-colors">
            Status
          </Link>
        </nav>
      </div>

      <ProvisioningLogsClient tenantId={t.id} />
    </div>
  )
}
