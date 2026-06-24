import Link from 'next/link'
import NewCampaignClient from './NewCampaignClient'
import { ap } from '@/lib/admin-path'
import { getHost } from '@/lib/get-host'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function NewCampaignPage() {
  const host = await getHost()
  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex items-center gap-2 text-sm text-foreground-secondary">
        <Link href={ap('/admin/campaigns', host)} className="text-accent-500 hover:text-accent-600 transition-colors">Campaigns</Link>
        <span>/</span>
        <span className="text-foreground">New Campaign</span>
      </div>
      <NewCampaignClient />
    </div>
  )
}
