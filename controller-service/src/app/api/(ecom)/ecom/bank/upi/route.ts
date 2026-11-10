import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { cookies } from 'next/headers'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/auth/owner-session'
import { extractSessionSignals } from '@/lib/auth/session-signals-request'
import { setOwnerUpiId } from '@/lib/tenant-registry'

export const dynamic = 'force-dynamic'

const Schema = z.object({
  upiId: z.string().trim().max(120).regex(/^[\w.\-]{2,}@[a-zA-Z]{2,}$/, 'A UPI ID looks like name@bank').nullable(),
})

// Owner changes only the UPI ID on their bank record (payouts page). The full bank form posts to
// /api/ecom/bank/verify; this avoids re-entering the account number for a UPI change.
export async function PATCH(request: NextRequest) {
  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const owner = await resolveOwnerSession(sid, extractSessionSignals(request))
  if (!owner) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const parsed = Schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid input' }, { status: 400 })

  const saved = await setOwnerUpiId(owner.id, parsed.data.upiId)
  if (!saved) return NextResponse.json({ error: 'Add a settlement account first.' }, { status: 409 })
  return NextResponse.json({ ok: true, upiId: parsed.data.upiId })
}
