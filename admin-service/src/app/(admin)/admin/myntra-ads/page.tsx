import MarketplaceAdsConsole from '@/components/admin/marketplace/MarketplaceAdsConsole'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default function MyntraAdsPage() {
  return (
    <div className="p-4 sm:p-6">
      <MarketplaceAdsConsole channel="myntra_ads" />
    </div>
  )
}
