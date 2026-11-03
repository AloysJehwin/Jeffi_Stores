import MetaAdsConsole from './_components/MetaAdsConsole'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Header, gear and console are client-side: the gear's state comes from the connection status.
export default function MetaAdsPage() {
  return (
    <div className="p-4 sm:p-6">
      <MetaAdsConsole />
    </div>
  )
}
