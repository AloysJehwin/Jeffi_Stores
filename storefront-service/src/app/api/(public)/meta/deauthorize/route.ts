import { NextRequest, NextResponse } from 'next/server'
import { deleteMetaUserData, signedRequestFrom, verifyMetaSignedRequest } from '@/lib/catalog/meta-privacy'

export const dynamic = 'force-dynamic'

// Meta's Deauthorize callback: a user removed the app, so the Meta tokens stored for them are deleted.
// Public: Meta signs the request with the app secret (?app=<app id> names a store's own app).
export async function POST(request: NextRequest) {
  const signed = await signedRequestFrom(request)
  if (!signed) return NextResponse.json({ error: 'Missing signed_request' }, { status: 400 })
  try {
    const who = await verifyMetaSignedRequest(signed, request.nextUrl.searchParams.get('app'))
    if (!who) return NextResponse.json({ error: 'Invalid signed_request' }, { status: 400 })
    const deleted = await deleteMetaUserData(who.userId, who.tenantIds)
    return NextResponse.json({ ok: true, deleted })
  } catch {
    return NextResponse.json({ error: 'retry' }, { status: 503 })
  }
}
