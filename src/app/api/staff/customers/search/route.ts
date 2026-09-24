import { NextRequest, NextResponse } from 'next/server'
import { requireStaff, isStaffDenied } from '@/lib/staff-auth'
import { searchCustomers } from '@/lib/customer-notes'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const auth = await requireStaff(request, 'customers:read')
  if (isStaffDenied(auth)) return auth
  const q = request.nextUrl.searchParams.get('q') || ''
  return NextResponse.json({ customers: await searchCustomers(q) })
}
