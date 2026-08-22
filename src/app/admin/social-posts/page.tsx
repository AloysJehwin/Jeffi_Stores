import { headers } from 'next/headers'
import { hasScope } from '@/lib/scopes'
import SocialPostsClient from './SocialPostsClient'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function SocialPostsPage() {
  const h = await headers()
  const role = h.get('x-user-role') || ''
  const scopes: string[] = JSON.parse(h.get('x-user-scopes') || '[]')
  const canWrite = hasScope(role, scopes, 'products:write')

  return (
    <div className="p-4 sm:p-6">
      <SocialPostsClient canWrite={canWrite} />
    </div>
  )
}
