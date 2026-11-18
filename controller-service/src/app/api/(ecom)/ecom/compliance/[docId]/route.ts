import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/auth/owner-session'
import { extractSessionSignals } from '@/lib/auth/session-signals-request'
import { getKycDocumentStream } from '@controller/lib/catalog/kyc-upload'
import { getOwnerComplianceDocument } from '@controller/lib/catalog/compliance-docs'

export const dynamic = 'force-dynamic'

// GET: one of the owner's own licences on file, for the console's Licences & certificates page.
export async function GET(request: NextRequest, { params }: { params: Promise<{ docId: string }> }) {
  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const owner = await resolveOwnerSession(sid, extractSessionSignals(request))
  if (!owner) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const { docId } = await params
  const doc = await getOwnerComplianceDocument(owner.id, docId)
  if (!doc) return NextResponse.json({ error: 'No such document on file' }, { status: 404 })

  const { body, contentType } = await getKycDocumentStream(doc.s3_key)
  return new NextResponse(body, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `inline; filename="${doc.doc_type}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  })
}
