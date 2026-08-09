import { headers } from 'next/headers'
import { hasScope } from '@/lib/scopes'
import ReviewsClient from './ReviewsClient'

export default async function AdminReviewsPage() {
  const h = await headers()
  const role = h.get('x-user-role') || ''
  const scopes: string[] = JSON.parse(h.get('x-user-scopes') || '[]')
  const canWrite = hasScope(role, scopes, 'reviews:write')

  return <ReviewsClient canWrite={canWrite} />
}
