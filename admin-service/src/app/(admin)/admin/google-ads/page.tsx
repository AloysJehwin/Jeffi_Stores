import GoogleAdsClient from './GoogleAdsClient'
import { adsTenantKey } from '@/lib/google-ads/credentials'
import { getAdsConnectionStatus } from '@/lib/google-ads/connection'
import { getAdsAccount } from '@/lib/google-ads/report'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function GoogleAdsPage() {
  const status = await getAdsConnectionStatus(await adsTenantKey())
  const account = await getAdsAccount()
  return (
    <GoogleAdsClient
      initialStatus={status}
      currency={account?.currency_code || 'INR'}
      hasData={!!account?.last_sync_at}
    />
  )
}
