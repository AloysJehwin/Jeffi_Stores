import MarketplaceConsole from '@/components/admin/marketplace/MarketplaceConsole'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default function AjioPage() {
  return (
    <div className="p-4 sm:p-6">
      <MarketplaceConsole channel="ajio" />
    </div>
  )
}
