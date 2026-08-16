import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { cookies } from 'next/headers'
import { createTenant, linkOwnerTenant, hasVerifiedBank } from '@/lib/tenant-registry'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/owner-session'
import { extractSessionSignals } from '@/lib/session-signals-request'

export const dynamic = 'force-dynamic'

const Schema = z.object({
  slug: z.string().min(3).max(63),
  displayName: z.string().min(1).max(200),
  planSlug: z.enum(['basic', 'growth', 'pro', 'enterprise']),
  dailyPayout: z.boolean().optional(),
  warehouse: z
    .object({
      originPincode: z.string().optional(),
      pickupLocation: z.string().optional(),
      sellerName: z.string().optional(),
      sellerAddress: z.string().optional(),
      sellerPhone: z.string().optional(),
    })
    .optional(),
})

// Owner-authed onboarding. Creates the tenant (status='provisioning') and links
// it to the signed-in owner. GATED: a verified bank account is mandatory before
// go-live (POBO — we won't create a store we can't pay out to).
export async function POST(request: NextRequest) {
  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const owner = await resolveOwnerSession(sid, extractSessionSignals(request))
  if (!owner) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const raw = await request.json().catch(() => null)
  if (!raw) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  const parsed = Schema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid input' }, { status: 400 })
  }

  // Mandatory-before-go-live: no verified payout account → no store.
  if (!(await hasVerifiedBank(owner.id))) {
    return NextResponse.json({ error: 'Please verify your bank account before creating your store.' }, { status: 400 })
  }

  const result = await createTenant(parsed.data)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  await linkOwnerTenant(owner.id, result.tenantId)

  return NextResponse.json({
    success: true,
    tenantId: result.tenantId,
    slug: result.slug,
    storefront: `https://${result.slug}.jeffistores.in`,
    status: 'provisioning',
  })
}

