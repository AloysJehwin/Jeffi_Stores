import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/auth/owner-session'
import { extractSessionSignals } from '@/lib/auth/session-signals-request'
import { findLatestBackup } from '@/lib/tenancy/tenant-backup-store'
import { findOwnerArchive } from '@/lib/tenant-registry'

export const dynamic = 'force-dynamic'

// Restore-on-re-onboard: what a deprovision kept for this owner (database, media files,
// configuration), so the wizard can ask what to bring back. Only ever the signed-in owner's own
// archive. A backup from before archives existed is offered as database only.
export async function GET(request: NextRequest) {
  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const owner = await resolveOwnerSession(sid, extractSessionSignals(request))
  if (!owner) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const archive = await findOwnerArchive(owner.id).catch(() => null)
  if (archive) {
    return NextResponse.json({
      available: true,
      capturedAt: archive.created_at,
      archive: {
        id: archive.id,
        slug: archive.slug,
        displayName: archive.display_name,
        expiresAt: archive.expires_at,
        database: archive.keep_database,
        media: archive.keep_media,
        config: archive.keep_config,
        mediaObjects: archive.media_objects,
        mediaBytes: Number(archive.media_bytes),
      },
    })
  }

  const backup = await findLatestBackup({ ownerId: owner.id }).catch(() => null)
  if (!backup) return NextResponse.json({ available: false })
  return NextResponse.json({
    available: true,
    key: backup.key,
    capturedAt: backup.capturedAt,
    sizeBytes: backup.sizeBytes ?? null,
  })
}
