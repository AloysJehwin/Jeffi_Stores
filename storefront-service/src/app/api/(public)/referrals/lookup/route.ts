import { NextRequest, NextResponse } from 'next/server'
import { resolveReferralCode } from '@/lib/referrals/codes'
import { readReferralCookie } from '@/lib/referrals/cookie'
import { isReferralLive } from '@/lib/referrals/settings'

export const dynamic = 'force-dynamic'

// Lets the signup page say who invited the visitor. Returns a first name only, nothing else.
export async function GET(request: NextRequest) {
  try {
    const code = readReferralCookie(request)
    if (!code || !(await isReferralLive())) return NextResponse.json({ firstName: null })
    const referral = await resolveReferralCode(code)
    return NextResponse.json({ firstName: referral?.referrerFirstName ?? null })
  } catch {
    return NextResponse.json({ firstName: null })
  }
}
