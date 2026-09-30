import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/auth/owner-session'
import { extractSessionSignals } from '@/lib/auth/session-signals-request'
import { findLatestBackup } from '@/lib/tenancy/tenant-backup-store'

export const dynamic = 'force-dynamic'

// Restore-on-re-onboard: does a returning owner have a backup from a previously
// deprovisioned store? Detects by owner id (and by slug if the caller passes ?slug=).
export async function GET(request: NextRequest) {
  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const owner = await resolveOwnerSession(sid, extractSessionSignals(request))
  if (!owner) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const slug = request.nextUrl.searchParams.get('slug') || undefined
  const backup = await findLatestBackup({ ownerId: owner.id, slug }).catch(() => null)

  if (!backup) return NextResponse.json({ available: false })
  return NextResponse.json({
    available: true,
    key: backup.key,
    capturedAt: backup.capturedAt,
    sizeBytes: backup.sizeBytes ?? null,
  })
}
