import { loadOwnerContext } from '@controller/lib/ecom/owner-context'
import { getTenantWallet } from '@/lib/payments/wallet'
import PageHeader from '../_components/PageHeader'
import WalletClient from './WalletClient'
import { walletUpiAvailable } from '@/lib/payments/upi/creds'

export const dynamic = 'force-dynamic'

export default async function WalletPage() {
  const { tenant } = await loadOwnerContext()
  const w = await getTenantWallet(tenant.id, 100)
  const upiEnabled = await walletUpiAvailable().catch(() => false)
  return (
    <>
      <PageHeader eyebrow="Finance" title="Wallet" description="One prepaid balance for messaging, documents and shipping. Shared with your store admin." />
      <WalletClient initial={{ balance: w.balance, ledger: w.ledger.map(e => ({ ...e, amount: Number(e.amount) })) }} keyId={process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID ?? ''} tenantName={tenant.display_name} upiEnabled={upiEnabled} />
    </>
  )
}
