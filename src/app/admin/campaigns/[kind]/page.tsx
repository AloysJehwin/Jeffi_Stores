import Link from 'next/link'
import CampaignDetailClient from './CampaignDetailClient'
import { ap } from '@/lib/admin-path'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default function CampaignDetailPage({ params }: { params: { kind: string } }) {
  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex items-center gap-2 text-sm text-foreground-secondary">
        <Link href={ap('/admin/campaigns')} className="text-accent-500 hover:text-accent-600 transition-colors">Campaigns</Link>
        <span>/</span>
        <span className="text-foreground capitalize">{params.kind.replace(/_/g, ' ')}</span>
      </div>
      <CampaignDetailClient kind={params.kind} />
    </div>
  )
}
