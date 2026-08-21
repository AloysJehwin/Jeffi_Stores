import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { isPlatformAdmin } from '@/lib/scopes'
import { getPendingKycList } from '@/lib/tenant-registry'
import KycActionButtons from './KycActionButtons'

export const dynamic = 'force-dynamic'

export default async function AdminKycPage() {
  const h = await headers()
  const role = h.get('x-user-role') || ''
  if (!isPlatformAdmin(role)) redirect('/admin')

  const pending = await getPendingKycList()

  return (
    <div className="p-6 lg:p-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">KYC Review Queue</h1>
          <p className="text-sm text-foreground-muted mt-1">
            {pending.length} pending application{pending.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Link href="/admin" className="text-sm text-foreground-muted hover:text-foreground">← Admin</Link>
      </div>

      {pending.length === 0 ? (
        <div className="rounded-2xl border border-border-default bg-surface-elevated p-16 text-center text-foreground-muted">
          No pending applications.
        </div>
      ) : (
        <div className="space-y-4">
          {pending.map((k) => (
            <div key={k.id} className="rounded-2xl border border-border-default bg-surface-elevated overflow-hidden">
              <div className="px-6 py-4 border-b border-border-default/60 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-bold text-foreground text-lg">{k.display_name}</div>
                  <div className="text-sm text-foreground-muted font-mono">{k.slug}.jeffistores.in</div>
                </div>
                <div className="text-xs text-foreground-muted">
                  Submitted {new Date(k.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 px-6 py-5">
                {[
                  ['Owner email',   k.owner_email],
                  ['Business name', k.business_name ?? '—'],
                  ['Business type', k.business_type ?? '—'],
                  ['PAN',           k.pan ?? '—'],
                  ['GSTIN',         k.gst_number ?? '—'],
                  ['Products',      k.product_categories ?? '—'],
                ].map(([label, value]) => (
                  <div key={label as string}>
                    <div className="text-xs text-foreground-muted uppercase tracking-widest mb-0.5">{label}</div>
                    <div className="text-sm font-medium text-foreground break-all">{value}</div>
                  </div>
                ))}
                {k.business_address && (
                  <div className="sm:col-span-2">
                    <div className="text-xs text-foreground-muted uppercase tracking-widest mb-0.5">Business address</div>
                    <div className="text-sm text-foreground">{k.business_address}</div>
                  </div>
                )}
              </div>

              <div className="px-6 pb-5 flex flex-wrap items-center justify-between gap-4 border-t border-border-default/60 pt-4">
                <div>
                  {k.gst_cert_s3_key ? (
                    <a href={`/api/admin/ecom/kyc/${k.tenant_id}/cert`} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border-default text-sm text-foreground hover:bg-surface-secondary transition-colors">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                      </svg>
                      View GST certificate
                    </a>
                  ) : (
                    <span className="text-sm text-foreground-muted">No certificate uploaded</span>
                  )}
                </div>
                <KycActionButtons tenantId={k.tenant_id} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
