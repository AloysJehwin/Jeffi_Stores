import AmazonAdsConsole from './_components/AmazonAdsConsole'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Header, gear and console are client-side: the gear's state comes from the connection status.
export default function AmazonAdsPage() {
  return (
    <div className="p-4 sm:p-6">
      <AmazonAdsConsole />
    </div>
  )
}
