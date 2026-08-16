import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { hasScope } from '@/lib/scopes'
import { listTenants } from '@/lib/tenant-registry'

export const dynamic = 'force-dynamic'

const DOT: Record<string, string> = {
  active: 'bg-green-500',
  provisioning: 'bg-amber-500',
  suspended: 'bg-red-500',
  terminated: 'bg-gray-400',
}

export default async function EcomStoreStatusPage() {
  const h = await headers()
  const role = h.get('x-user-role') || ''
  const scopes = (h.get('x-user-scopes') || '').split(',').filter(Boolean)
  if (role !== 'super_admin' && !hasScope(role, scopes, 'ecom_customers:read')) redirect('/admin')

  const tenants = await listTenants()

  return (
    <div className="p-6 w-full">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">Ecom Store — Store Status</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Live status of each tenant store</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {tenants.length === 0 && <p className="text-gray-400">No tenants yet.</p>}
        {tenants.map((t) => (
          <div key={t.id} className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800">
            <div className="flex items-center justify-between">
              <span className="font-medium text-gray-900 dark:text-white">{t.display_name}</span>
              <span className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                <span className={`w-2 h-2 rounded-full ${DOT[t.status] || DOT.terminated}`} />
                {t.status}
              </span>
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{t.slug}.jeffistores.in</div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-2 capitalize">Plan: {t.plan || '—'}</div>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-400 mt-4">Uptime, last-deploy and health-check status wire in once the tenant fleet + /api/ready probes are live.</p>
    </div>
  )
}
