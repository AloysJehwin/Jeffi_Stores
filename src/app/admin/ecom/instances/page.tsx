import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { hasScope } from '@/lib/scopes'
import { listTenants } from '@/lib/tenant-registry'
import { EcomFilters } from '@/components/admin/ecom/EcomUI'

export const dynamic = 'force-dynamic'

type SP = { [k: string]: string | string[] | undefined }
const one = (sp: SP, k: string) => (Array.isArray(sp[k]) ? (sp[k] as string[])[0] : (sp[k] as string | undefined))

export default async function EcomInstancesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const h = await headers()
  const role = h.get('x-user-role') || ''
  const scopes = (h.get('x-user-scopes') || '').split(',').filter(Boolean)
  if (role !== 'super_admin' && !hasScope(role, scopes, 'ecom_instances:read')) redirect('/admin')

  const sp = await searchParams
  const tenants = await listTenants({ status: one(sp, 'status'), plan: one(sp, 'plan'), q: one(sp, 'q') })
  const provisioned = tenants.filter((t) => t.rds_endpoint).length

  return (
    <div className="p-6 w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Instances</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Per-tenant infrastructure — {provisioned}/{tenants.length} provisioned</p>
      </div>

      <EcomFilters />

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-800">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900/50 text-gray-500 dark:text-gray-400">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Store</th>
              <th className="text-left px-4 py-3 font-medium">RDS endpoint</th>
              <th className="text-left px-4 py-3 font-medium">EC2 target</th>
              <th className="text-left px-4 py-3 font-medium">S3 bucket</th>
              <th className="text-left px-4 py-3 font-medium">Region</th>
              <th className="text-right px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {tenants.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No tenants match.</td></tr>
            )}
            {tenants.map((t) => (
              <tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-gray-900/30">
                <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                  <Link href={`/admin/ecom/customers/${t.id}`} className="hover:text-accent-600">{t.display_name}</Link>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-gray-600 dark:text-gray-300">{t.rds_endpoint || <span className="text-amber-500">not provisioned</span>}</td>
                <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{t.ec2_target || 'pool'}</td>
                <td className="px-4 py-3 font-mono text-xs text-gray-600 dark:text-gray-300">{t.s3_bucket || '—'}</td>
                <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{t.region || '—'}</td>
                <td className="px-4 py-3 text-right"><Link href={`/admin/ecom/customers/${t.id}`} className="text-accent-600 dark:text-accent-400 hover:underline">Detail →</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400 mt-4">Live AWS health (CloudWatch CPU/connections, RDS/EC2 status) wires in with the provisioning engine.</p>
    </div>
  )
}
