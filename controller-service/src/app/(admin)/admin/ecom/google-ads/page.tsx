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
  return <ManagedAccountsClient managerId={env.managerId} configured={!!env.managerId && env.managerRefreshToken && env.developerToken} />
}
