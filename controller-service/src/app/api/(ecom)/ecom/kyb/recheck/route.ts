import { NextRequest, NextResponse, after } from 'next/server'
import { ownerApi } from '@controller/lib/ecom/owner-api'
import { queueRecheck } from '@controller/lib/kyb/analyze'
import { loadKybView } from '@controller/lib/kyb/view'
import { allow } from '@controller/lib/kyb/throttle'

export const dynamic = 'force-dynamic'

/** Runs the automatic check again on the business's KYB documents (after a failed read, or to retry). */
export async function POST(request: NextRequest) {
  const ctx = await ownerApi(request)
  if (ctx instanceof NextResponse) return ctx
  if (!allow(`kyb-recheck:${ctx.tenant.id}`, 3, 10 * 60_000))
    return NextResponse.json({ error: 'Checks are already running. Try again in a few minutes.' }, { status: 429 })
  const job = await queueRecheck(ctx.tenant.id, { all: true })
  if (job.count) after(job.run)
  return NextResponse.json({ kyb: await loadKybView(ctx.tenant, ctx.owner.id), checking: job.count })
}
