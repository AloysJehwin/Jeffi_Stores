import MarketplaceAdsConsole from '@/components/admin/marketplace/MarketplaceAdsConsole'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default function AjioAdsPage() {
  return (
    <div className="p-4 sm:p-6">
      <MarketplaceAdsConsole channel="ajio_ads" />
    </div>
  )
}
