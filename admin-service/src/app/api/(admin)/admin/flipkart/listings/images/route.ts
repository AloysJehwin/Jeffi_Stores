import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { withPlan } from '@/lib/channels/route'
import { imagesPack } from '@/lib/marketplace/catalog-routes'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

/** The zip of photos shaped to Flipkart's spec for the picked units. */
export async function POST(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'flipkart:write'), 'flipkart:write', 'Flipkart')
  if (admin instanceof NextResponse) return admin
  return imagesPack(request, 'flipkart', admin)
}
