import GoogleMerchantPanel from '@/components/admin/merchant/GoogleMerchantPanel'
import AmazonMerchantPanel from '@/components/admin/merchant/AmazonMerchantPanel'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default function MerchantSyncPage() {
  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Merchant Sync</h1>
        <p className="text-sm text-foreground-secondary mt-1">
          Manage and inspect the product feeds pushed to online marketplaces.
        </p>
      </div>

      <GoogleMerchantPanel />
      <AmazonMerchantPanel />
    </div>
  )
}
