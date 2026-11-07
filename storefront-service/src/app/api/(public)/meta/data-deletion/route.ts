import { NextRequest, NextResponse } from 'next/server'
import { storeBaseUrlAsync } from '@/lib/catalog/brand'
import { deleteMetaUserData, deletionCode, signedRequestFrom, verifyMetaSignedRequest } from '@/lib/catalog/meta-privacy'

export const dynamic = 'force-dynamic'

// Meta's Data Deletion Request callback (set in the Meta app). Public: Meta signs the request with the app
// secret. Deletes the user's stored Meta tokens and answers with a status URL and confirmation code.
// A store's own app can add ?app=<app id> to the URL so the right secret is tried first.
export async function POST(request: NextRequest) {
  const signed = await signedRequestFrom(request)
  if (!signed) return NextResponse.json({ error: 'Missing signed_request' }, { status: 400 })
  const who = await verifyMetaSignedRequest(signed, request.nextUrl.searchParams.get('app')).catch(() => undefined)
  if (who === undefined) return NextResponse.json({ error: 'retry' }, { status: 503 })
  if (!who) return NextResponse.json({ error: 'Invalid signed_request' }, { status: 400 })
  let deleted: number
  try {
    deleted = await deleteMetaUserData(who.userId, who.tenantIds)
  } catch {
    return NextResponse.json({ error: 'retry' }, { status: 503 })
  }
  const code = deletionCode(deleted)
  const url = `${await storeBaseUrlAsync()}/meta/data-deletion?code=${encodeURIComponent(code)}`
  return NextResponse.json({ url, confirmation_code: code })
}
