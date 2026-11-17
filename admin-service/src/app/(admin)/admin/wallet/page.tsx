import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { getTenantWallet } from '@/lib/payments/wallet'
import { redirect } from 'next/navigation'
import { queryMany } from '@/lib/shared/db'
import WalletClient, { type AiSpendRow } from './WalletClient'
import { walletUpiAvailable } from '@/lib/payments/upi/creds'
import { platformBrandName } from '@/lib/catalog/brand'

const AI_SPEND_DAYS = 30

// AI charged to this store's wallet by feature (ai_usage, written by lib/ai/billing). Calls the platform paid for (a free
// first site build: wallet_ref platform:<label>) keep their list price for the platform's books; here they are free.
async function aiSpend(): Promise<AiSpendRow[]> {
  const rows = await queryMany<{ feature: string; free: boolean; calls: string; spent: string; unpaid: string }>(
    `SELECT feature, COALESCE(wallet_ref, '') LIKE 'platform:%' AS free, COUNT(*) AS calls,
       COALESCE(SUM(price_inr) FILTER (WHERE status IN ('ok', 'pending') AND COALESCE(wallet_ref, '') NOT LIKE 'platform:%'), 0) AS spent,
       COUNT(*) FILTER (WHERE status = 'unpaid') AS unpaid
     FROM ai_usage WHERE created_at >= now() - ($1 || ' days')::interval
     GROUP BY 1, 2 ORDER BY 4 DESC, 3 DESC`,
    [String(AI_SPEND_DAYS)]
  ).catch(() => [])
  const paidBy = platformBrandName()
  return rows.map(r => ({ feature: r.feature, calls: Number(r.calls), spent: Number(r.spent), unpaid: Number(r.unpaid), ...(r.free ? { paidBy } : {}) }))
}

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Every tenant: the wallet pays for platform Delhivery shipping and for AI usage. The flagship has none.
export default async function WalletPage() {
  const tenantId = await resolveTenantId().catch(() => null)
  if (!tenantId) redirect('/admin/dashboard')
  const [wallet, ai, upiEnabled] = await Promise.all([
    // Balance only; the ledger pages in from the server with the list's filters.
    tenantId ? getTenantWallet(tenantId, 0).catch(() => null) : null,
    tenantId ? aiSpend() : [],
    walletUpiAvailable().catch(() => false),
  ])

  return <WalletClient initial={wallet} aiSpend={ai} aiSpendDays={AI_SPEND_DAYS} upiEnabled={upiEnabled} />
}
