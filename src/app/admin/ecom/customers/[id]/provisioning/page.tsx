import { headers } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { isPlatformAdmin } from '@/lib/scopes'
import { getTenant } from '@/lib/tenant-registry'
import { StatusPill } from '@/components/admin/ecom/EcomUI'
import ProvisioningLogsClient from './ProvisioningLogsClient'

export const dynamic = 'force-dynamic'

// Provisioning instance detail — live step-by-step logs of the provisioning job for a tenant.
export default async function ProvisioningDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const h = await headers()
  const role = h.get('x-user-role') || ''
  if (!isPlatformAdmin(role)) redirect('/admin')

  const { id } = await params
  const t = await getTenant(id)
  if (!t) notFound()

  return (
    <div className="p-6 w-full">
      <Link href={`/admin/ecom/customers/${id}`} className="text-sm text-accent-600 dark:text-accent-400 hover:underline">← {t.display_name}</Link>
      <div className="flex items-center gap-3 mt-2 mb-6">
        <h1 className="text-2xl font-bold text-foreground">Provisioning · {t.slug}</h1>
        <StatusPill status={t.status} />
      </div>
      <ProvisioningLogsClient tenantId={t.id} slug={t.slug} />
    </div>
  )
}
