import { NextRequest, NextResponse } from 'next/server'
import { computeEdd } from '@/lib/edd'
import { getBusinessValues } from '@/lib/site-controls'

export async function GET(request: NextRequest) {
  const pin = request.nextUrl.searchParams.get('pin') ?? ''
  const handlingDays = parseInt(request.nextUrl.searchParams.get('handlingDays') ?? '2') || 2
  const extraDays = parseInt(request.nextUrl.searchParams.get('extraDays') ?? '0') || 0
  const bv = await getBusinessValues().catch(() => null)
  const edd = computeEdd({ pin, originPin: bv?.delhiveryOriginPincode, handlingDays, extraDays })
  return NextResponse.json({ edd })
}
