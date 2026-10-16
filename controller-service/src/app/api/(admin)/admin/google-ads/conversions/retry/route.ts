import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminScope } from '@/lib/auth/jwt'
import { retryFailedUploads } from '@/lib/google-ads/conversions/console'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const Body = z.object({ ids: z.array(z.number().int().positive()).max(2000).optional() })

// Re-queue failed uploads (all, or the given ids) for the next run, with a fresh attempt budget.
export async function POST(request: NextRequest) {
  const admin = await requireAdminScope(request, 'google_ads:write')
  if (admin instanceof NextResponse) return admin
  const parsed = Body.safeParse((await request.json().catch(() => null)) ?? {})
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 })
  try {
    return NextResponse.json({ retried: await retryFailedUploads(parsed.data.ids ?? null) })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Could not retry' }, { status: 500 })
  }
}
