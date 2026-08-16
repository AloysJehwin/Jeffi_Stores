import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/owner-session'
import { extractSessionSignals } from '@/lib/session-signals-request'
import { getBankVerifier } from '@/lib/bank-verify'
import { saveBankVerification } from '@/lib/tenant-registry'

export const dynamic = 'force-dynamic'

// Owner submits bank details → penny-drop verification (stubbed) → recorded.
// A verified bank is mandatory before the store can go live.
export async function POST(request: NextRequest) {
  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const owner = await resolveOwnerSession(sid, extractSessionSignals(request))
  if (!owner) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  const { accountNumber, ifsc, holderName, upiId } = body

  const result = await getBankVerifier().verify({ accountNumber, ifsc, holderName, upiId })
  const saved = await saveBankVerification({
    ownerId: owner.id, accountNumber, ifsc, holderName, upiId,
    status: result.status, ref: result.ref, verifiedName: result.verifiedName,
  })

  return NextResponse.json({
    status: result.status,
    verifiedName: result.verifiedName ?? null,
    reason: result.reason ?? null,
    bankId: saved.id,
  }, { status: result.status === 'verified' ? 200 : 400 })
}
