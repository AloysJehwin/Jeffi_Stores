import CampaignsListClient from './CampaignsListClient'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default function CampaignsPage() {
  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Campaigns</h1>
        <p className="text-foreground-secondary mt-1 text-sm">Automated marketing campaigns triggered by customer behavior</p>
      </div>
      <CampaignsListClient />
    </div>
  )
}
