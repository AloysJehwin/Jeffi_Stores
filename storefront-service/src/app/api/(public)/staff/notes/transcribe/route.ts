import { NextRequest, NextResponse } from 'next/server'
import { requireStaff, isStaffDenied } from '@/lib/auth/staff-auth'
import { hasScope } from '@/lib/auth/scopes'
import { MAX_TRANSCRIBE_SECONDS, normalizeLanguageHint, transcribeAudio } from '@/lib/shared/transcribe'

export const dynamic = 'force-dynamic'

const STATUS = { too_large: 413, empty: 422, unavailable: 503, failed: 502 } as const

// Transcribes a staff voice memo. The audio itself is still saved by POST /api/staff/notes.
export async function POST(request: NextRequest) {
  const auth = await requireStaff(request, 'customers:write')
  if (isStaffDenied(auth)) return auth
  const { session } = auth
  if (!hasScope(session.role, session.scopes, 'customers:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const fd = await request.formData().catch(() => null)
  if (!fd) return NextResponse.json({ error: 'Expected multipart form data' }, { status: 400 })
  const file = fd.get('file')
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: 'file required' }, { status: 400 })
  const mimeType = (file.type || '').split(';')[0].trim().toLowerCase()
  if (!mimeType.startsWith('audio/') && mimeType !== 'video/webm') {
    return NextResponse.json({ error: `Unsupported file type: ${file.type || 'unknown'}` }, { status: 400 })
  }
  const duration = Number(fd.get('durationSeconds') || 0)
  if (duration > MAX_TRANSCRIBE_SECONDS) {
    return NextResponse.json({ error: `Recordings over ${MAX_TRANSCRIBE_SECONDS / 60} minutes cannot be transcribed` }, { status: 413 })
  }

  const r = await transcribeAudio({
    audio: Buffer.from(await file.arrayBuffer()),
    mimeType,
    language: normalizeLanguageHint(fd.get('language')),
    feature: 'staff_voice_memo',
  })
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: STATUS[r.code] })
  return NextResponse.json({ text: r.text, language: r.language, durationSeconds: r.durationSeconds })
}
