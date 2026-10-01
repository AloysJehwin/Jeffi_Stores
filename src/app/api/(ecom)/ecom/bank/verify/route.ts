import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { cookies } from 'next/headers'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/auth/owner-session'
import { extractSessionSignals } from '@/lib/auth/session-signals-request'
import { verifyBankAccountFAV } from '@/lib/payments/bank-verify'

export const dynamic = 'force-dynamic'

const Schema = z.object({
  accountNumber: z.string().min(9).max(18),
  ifsc: z.string().min(11).max(11),
  holderName: z.string().min(1).max(200),
})

// Owner submits bank details → recorded against the owner for Route settlements.
// Where a RazorpayX balance is configured, FAV penny-drops to confirm the holder name; otherwise
// the details are format-checked and stored 'unverified'. Both are accepted for go-live —
// Razorpay validates the account when the Route linked account is configured.
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
  if (result.status === 'failed') {
    return NextResponse.json(
      { status: result.status, verifiedName: null, reason: result.reason ?? null },
      { status: 400 }
    )
  }

  // Push to Route when the owner already has a linked account. Storing the correction locally
  // was not enough: Razorpay keeps settling to the old account until its settlement config is
  // updated, so a bank fixed here never reached the place the money actually goes.
  let settlement: { ok: boolean; error?: string } | null = null
  const { getOwnerBankWithRoute, saveBankVerification } = await import('@/lib/tenant-registry')
  const existing = await getOwnerBankWithRoute(owner.id).catch(() => null)
  if (existing?.linkedAccountId) {
    const { configureRouteSettlement } = await import('@/lib/payments/razorpay-route')
    settlement = await configureRouteSettlement(existing.linkedAccountId, {
      accountNumber,
      ifsc: ifsc.toUpperCase(),
      beneficiaryName: result.verifiedName ?? holderName,
    })
    // Razorpay is the authority on whether this account can receive money, so its answer —
    // not the local format check — decides what the owner is shown.
    await saveBankVerification({
      ownerId: owner.id,
      accountNumber,
      ifsc: ifsc.toUpperCase(),
      holderName,
      status: settlement.ok ? 'verified' : 'failed',
      ref: settlement.ok ? 'route_settlement' : 'route_rejected',
      verifiedName: result.verifiedName ?? holderName,
    }).catch(() => {})
  }

  const ok = settlement ? settlement.ok : true
  return NextResponse.json(
    {
      status: settlement ? (settlement.ok ? 'verified' : 'failed') : result.status,
      verifiedName: result.verifiedName ?? null,
      reason: settlement?.error ?? result.reason ?? null,
      pushedToRoute: !!settlement,
    },
    { status: ok ? 200 : 400 }
  )
}
