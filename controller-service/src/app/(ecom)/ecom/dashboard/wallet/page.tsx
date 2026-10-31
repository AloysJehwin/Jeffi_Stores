import { loadOwnerContext } from '@controller/lib/ecom/owner-context'
import { getTenantWallet } from '@/lib/payments/wallet'
import { serversBilling } from '@controller/lib/billing/infra-status'
import PageHeader from '../_components/PageHeader'
import WalletClient from './WalletClient'

export const dynamic = 'force-dynamic'

export default async function WalletPage() {
  const { tenant } = await loadOwnerContext()
  const [w, servers] = await Promise.all([getTenantWallet(tenant.id, 100), serversBilling(tenant.id).catch(() => null)])
  return (
    <>
      <PageHeader eyebrow="Finance" title="Wallet" description={`One prepaid balance for messaging, documents, shipping${servers ? ' and your servers' : ''}. Shared with your store admin.`} />
      <WalletClient initial={{ balance: w.balance, ledger: w.ledger.map(e => ({ ...e, amount: Number(e.amount) })) }} keyId={process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID ?? ''} tenantName={tenant.display_name} servers={servers} />
    </>
  )
}
