import { NextRequest, NextResponse } from 'next/server'
import { computeEdd } from '@/lib/shipping/edd'
import { getBusinessValues } from '@/lib/catalog/site-controls'

// Product cards, product pages and the checkout preview all resolve their EDD here, with the same
// computeEdd + store settings the order-commit paths use.
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const pin = sp.get('pin') ?? ''
  const handling = parseInt(sp.get('handlingDays') ?? '')
  const extraDays = parseInt(sp.get('extraDays') ?? '0') || 0
  const store = await getBusinessValues().catch(() => null)
  const edd = computeEdd({
    pin,
    store,
    handlingDays: Number.isFinite(handling) ? handling : undefined,
    extraDays,
  })
  return NextResponse.json({ edd })
}
