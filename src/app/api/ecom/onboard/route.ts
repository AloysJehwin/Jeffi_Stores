import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createTenant } from '@/lib/tenant-registry'

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

// Public onboarding endpoint (ecom.jeffistores.in). Creates a tenant in the
// control-plane registry with status='provisioning'. AWS provisioning is a
// separate async step; this only records the tenant + intent.
export async function POST(request: NextRequest) {
  const raw = await request.json().catch(() => null)
  if (!raw) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  const parsed = Schema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid input' }, { status: 400 })
  }
  const result = await createTenant(parsed.data)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({
    success: true,
    tenantId: result.tenantId,
    slug: result.slug,
    storefront: `https://${result.slug}.jeffistores.in`,
    status: 'provisioning',
  })
}
