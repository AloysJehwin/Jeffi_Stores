import { NextResponse } from 'next/server'
import { getPublicOffers } from '@/lib/payments/razorpay-offers'

export const dynamic = 'force-dynamic'

// Was a hardcoded list of bank offers that did not exist on this Razorpay account. Now serves
// the account's real active offers; getPublicOffers caches and returns [] rather than throwing.
export async function GET() {
  const offers = await getPublicOffers()
  return NextResponse.json({ offers })
}
