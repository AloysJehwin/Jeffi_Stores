import MetaAdsConsole from './_components/MetaAdsConsole'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default function MetaAdsPage() {
  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Meta Ads</h1>
        <p className="text-sm text-foreground-secondary mt-0.5">Facebook and Instagram ads: spend, purchases, true ROAS from your orders, and the Conversions API</p>
      </div>
      <MetaAdsConsole />
    </div>
  )
}
