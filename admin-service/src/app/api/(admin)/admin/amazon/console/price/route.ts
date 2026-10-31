import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminScope } from '@/lib/auth/jwt'
import { actorOf, channelError, readJson, withPlan } from '@/lib/channels/route'
import { changeAmazonPrice } from '@/lib/amazon/console'

export const dynamic = 'force-dynamic'

const Body = z.object({ sku: z.string().min(1).max(200), price: z.number().positive().max(10_000_000), allowBelowFloor: z.boolean().optional(), preview: z.boolean().optional() })

/** One Amazon price change; preview runs Amazon's validation and shows margin before and after. */
export async function POST(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'amazon_pricing:write'), 'amazon_pricing:write', 'Amazon pricing')
  if (admin instanceof NextResponse) return admin
  const parsed = Body.safeParse(await readJson(request))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  try {
    const { sku, price, allowBelowFloor, preview } = parsed.data
    const out = await changeAmazonPrice(sku, price, actorOf(admin), preview === true, { allowBelowFloor })
    return NextResponse.json(out, { status: out.ok || out.preview ? 200 : 400 })
  } catch (e) {
    return channelError(e, 'Connect Amazon first.')
  }
}
