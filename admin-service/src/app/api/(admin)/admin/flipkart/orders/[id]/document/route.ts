import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { withPlan } from '@/lib/channels/route'
import { orderDocumentGet } from '@/lib/marketplace/orders-route'

export const dynamic = 'force-dynamic'

/** ?kind=label|invoice|manifest: the PDF for a Flipkart order. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await withPlan(await requireAdminScope(request, 'flipkart:read'), 'flipkart:read', 'Flipkart')
  if (admin instanceof NextResponse) return admin
  const { id } = await params
  return orderDocumentGet(request, 'flipkart', id)
}
