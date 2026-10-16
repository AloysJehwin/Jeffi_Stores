import AmazonAdsConsole from './_components/AmazonAdsConsole'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default function AmazonAdsPage() {
  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Amazon Ads</h1>
        <p className="text-sm text-foreground-secondary mt-0.5">Sponsored Products: spend, ACoS and TACoS, campaigns, keywords, search terms and products</p>
      </div>
      <AmazonAdsConsole />
    </div>
  )
}
