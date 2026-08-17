import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { cookies } from 'next/headers'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/owner-session'
import { extractSessionSignals } from '@/lib/session-signals-request'
import { verifyBankAccountFAV } from '@/lib/bank-verify'

export const dynamic = 'force-dynamic'

const Schema = z.object({
  accountNumber: z.string().min(9).max(18),
  ifsc: z.string().min(11).max(11),
  holderName: z.string().min(1).max(200),
})

// Owner submits bank details → Razorpay FAV instant verification → recorded in DB.
// A verified bank is mandatory before the store can go live.
export async function POST(request: NextRequest) {
  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const owner = await resolveOwnerSession(sid, extractSessionSignals(request))
  if (!owner) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const raw = await request.json().catch(() => null)
  if (!raw) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  const parsed = Schema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })

  const { accountNumber, ifsc, holderName } = parsed.data

  const result = await verifyBankAccountFAV(owner.id, {
    accountNumber,
    ifsc: ifsc.toUpperCase(),
    holderName,
  })

  return NextResponse.json({
    status: result.status,
    verifiedName: result.verifiedName ?? null,
    reason: result.reason ?? null,
  }, { status: result.status === 'verified' ? 200 : 400 })
}
