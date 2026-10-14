import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ownerApi } from '@/lib/ecom/owner-api'
import { upgradeTenantToStore, hasService, hasVerifiedBank } from '@/lib/tenant-registry'
import { parseBody } from '@/lib/shared/validate'

export const dynamic = 'force-dynamic'

/** Services-only tenant adds a store: same tenant id (and wallet), enters KYC approval → payment → provisioning. */
export async function POST(request: NextRequest) {
  const ctx = await ownerApi(request)
  if (ctx instanceof NextResponse) return ctx
  if (hasService(ctx.tenant, 'store')) return NextResponse.json({ error: 'This workspace already has a store.' }, { status: 400 })
  const parsed = parseBody(
    z.object({ planSlug: z.enum(['basic', 'growth', 'pro', 'enterprise']), billingInterval: z.enum(['monthly', 'yearly']).default('monthly') }),
    await request.json().catch(() => ({}))
  )
  if (!parsed.ok) return parsed.response
  if (!(await hasVerifiedBank(ctx.owner.id))) return NextResponse.json({ error: 'Verify your payout bank account first (Finance → Payouts).' }, { status: 400 })
  const r = await upgradeTenantToStore(ctx.tenant.id, parsed.data.planSlug, parsed.data.billingInterval)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true })
}
