import { NextRequest, NextResponse } from 'next/server'
import { requireStaff, isStaffDenied } from '@/lib/auth/staff-auth'
import { searchOrdersForCustomer } from '@/lib/shared/customer-notes'
import { zUuid } from '@/lib/shared/validate'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const auth = await requireStaff(request, 'customers:read')
  if (isStaffDenied(auth)) return auth
  const customerId = zUuid.safeParse(request.nextUrl.searchParams.get('customerId'))
  if (!customerId.success) return NextResponse.json({ error: 'customerId required' }, { status: 400 })
  const q = request.nextUrl.searchParams.get('q') || ''
  return NextResponse.json({ orders: await searchOrdersForCustomer(customerId.data, q) })
}
