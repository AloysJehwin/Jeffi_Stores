import { NextRequest, NextResponse } from 'next/server'
import { computeEdd } from '@/lib/edd'

export async function GET(request: NextRequest) {
  const pin = request.nextUrl.searchParams.get('pin') ?? ''
  const handlingDays = parseInt(request.nextUrl.searchParams.get('handlingDays') ?? '2') || 2
  const extraDays = parseInt(request.nextUrl.searchParams.get('extraDays') ?? '0') || 0
  const edd = computeEdd({ pin, handlingDays, extraDays })
  return NextResponse.json({ edd })
}
