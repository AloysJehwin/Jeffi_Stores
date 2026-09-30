import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/owner-session'
import { extractSessionSignals } from '@/lib/session-signals-request'
import { uploadKycDocument } from '@/lib/kyc-upload'

export const dynamic = 'force-dynamic'

// Accepts multipart/form-data with field "file" (the GST cert PDF/image).
// Returns { s3Key } to store in the draft data.
export async function POST(request: NextRequest) {
  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const owner = await resolveOwnerSession(sid, extractSessionSignals(request))
  if (!owner) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const formData = await request.formData().catch(() => null)
  if (!formData) return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })

  const file = formData.get('file')
  if (!file || typeof file === 'string') return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  const MAX_SIZE = 5 * 1024 * 1024 // 5 MB
  if (file.size > MAX_SIZE) return NextResponse.json({ error: 'File too large (max 5 MB)' }, { status: 400 })

  const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
  if (!allowed.includes(file.type))
    return NextResponse.json({ error: 'Only PDF, JPG, PNG, or WebP allowed' }, { status: 400 })

  const buffer = Buffer.from(await file.arrayBuffer())
  const s3Key = await uploadKycDocument({
    buffer,
    originalFilename: file.name,
    mimeType: file.type,
    ownerId: owner.id,
  })

  return NextResponse.json({ ok: true, s3Key })
}
