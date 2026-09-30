import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/owner-session'
import { extractSessionSignals } from '@/lib/session-signals-request'
import { uploadBrandingImage } from '@/lib/s3'

export const dynamic = 'force-dynamic'

// Multipart upload of an onboarding branding asset (logo or seal). Owner-gated. Field "file"
// + "kind" ('logo'|'seal'). Returns { s3Key, url } for the draft + KYC record; the URL is used
// on the storefront and in generated legal documents.
export async function POST(request: NextRequest) {
  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const owner = await resolveOwnerSession(sid, extractSessionSignals(request))
  if (!owner) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const formData = await request.formData().catch(() => null)
  if (!formData) return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })

  const file = formData.get('file')
  const kind = formData.get('kind')
  if (!file || typeof file === 'string') return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  if (kind !== 'logo' && kind !== 'seal')
    return NextResponse.json({ error: 'kind must be logo or seal' }, { status: 400 })

  const MAX_SIZE = 3 * 1024 * 1024 // 3 MB
  if (file.size > MAX_SIZE) return NextResponse.json({ error: 'File too large (max 3 MB)' }, { status: 400 })
  const allowed = ['image/jpeg', 'image/png', 'image/webp']
  if (!allowed.includes(file.type))
    return NextResponse.json({ error: 'Only JPG, PNG, or WebP allowed' }, { status: 400 })

  const buffer = Buffer.from(await file.arrayBuffer())
  const { s3Key, url } = await uploadBrandingImage(buffer, owner.id, kind)
  return NextResponse.json({ ok: true, s3Key, url })
}
