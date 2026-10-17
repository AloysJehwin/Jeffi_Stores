import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { isPlatformAdmin } from '@/lib/auth/scopes'
import { googleAdsEnvStatus } from '@/lib/google-ads/credentials'
import ManagedAccountsClient from './ManagedAccountsClient'

export const dynamic = 'force-dynamic'

export default async function EcomGoogleAdsPage() {
  const role = (await headers()).get('x-user-role') || ''
  if (!isPlatformAdmin(role)) redirect('/admin')
  const env = googleAdsEnvStatus()
  // Only used for "managed by Jeffi" Ads (stores connect their own accounts otherwise); off until set up.
  if (!(env.developerToken && env.managerId && env.managerRefreshToken)) redirect('/admin/ecom/customers')
  return <ManagedAccountsClient managerId={env.managerId} configured={!!env.managerId && env.managerRefreshToken && env.developerToken} />
}
