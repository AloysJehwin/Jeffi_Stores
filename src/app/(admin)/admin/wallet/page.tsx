import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { getSiteControls } from '@/lib/catalog/site-controls'
import { getTenantWallet } from '@/lib/payments/wallet'
import { redirect } from 'next/navigation'
import WalletClient from './WalletClient'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Platform-Delhivery tenants only — own-Delhivery/flagship have no platform wallet. The nav link
// and badge are already gated in the layout; this guards a direct URL hit.
export default async function WalletPage() {
  const controls = await getSiteControls()
  if (controls.ownDelhivery) redirect('/admin/dashboard')

  const tenantId = await resolveTenantId().catch(() => null)
  const wallet = tenantId ? await getTenantWallet(tenantId, 500).catch(() => null) : null

  return <WalletClient initial={wallet} />
}
