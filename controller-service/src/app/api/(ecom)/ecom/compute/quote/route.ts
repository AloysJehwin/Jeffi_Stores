import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/auth/owner-session'
import { extractSessionSignals } from '@/lib/auth/session-signals-request'
import { getCatalog, planCompute } from '@controller/lib/compute/catalog'
import { ComputeSpecSchema } from '@controller/lib/compute/schema'
import { quoteForPlan } from '@controller/lib/compute/quote'

export const dynamic = 'force-dynamic'

const Body = z.object({ planSlug: z.string().max(40), spec: ComputeSpecSchema })

/** The server's price for a compute choice on a plan, whether it is allowed and fits, and whether there is capacity. */
export async function POST(request: NextRequest) {
  const owner = await resolveOwnerSession((await cookies()).get(OWNER_COOKIE)?.value, extractSessionSignals(request))
  if (!owner) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  const plan = await planCompute(parsed.data.planSlug)
  if (!plan) return NextResponse.json({ error: 'Unknown plan' }, { status: 400 })
  return NextResponse.json(await quoteForPlan(parsed.data.spec, plan, await getCatalog()))
}
