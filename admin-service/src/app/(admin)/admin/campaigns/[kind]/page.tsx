import { permanentRedirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Canonical URLs are /campaigns/<kind>/view (read-only) and /campaigns/<kind>/edit (editor).
// The bare detail URL now redirects to the view page.
export default async function CampaignDetailPage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params
  permanentRedirect(ap(`/admin/campaigns/${kind}/view`, await getHost()))
}
