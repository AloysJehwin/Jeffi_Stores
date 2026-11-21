import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/auth/owner-session'
import { extractSessionSignals } from '@/lib/auth/session-signals-request'
import { getDraft } from '@/lib/tenant-registry'
import { parseBody } from '@/lib/shared/validate'
import { kycKeyPrefix } from '@controller/lib/catalog/kyc-upload'
import { isIsoDate } from '@controller/lib/catalog/compliance'
import { docNumberProblem } from '@controller/lib/kyb/requirements'
import { checkUpload } from '@controller/lib/kyb/analyze'
import { allow } from '@controller/lib/kyb/throttle'
import { isKybDoc, kybExpected } from '@controller/app/(ecom)/ecom/onboard/kyb'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const Body = z.object({
  s3Key: z.string().min(1).max(512),
  docType: z.string().max(40),
  number: z.string().trim().max(64).optional(),
  expiresOn: z.string().max(10).optional(),
})

/**
 * The wizard's check on a KYB document it just uploaded: read and compared with the answers on the owner's draft (the
 * wizard saves it first), nothing stored. The PAN card and GST certificate are compared with the PAN and GSTIN there; a
 * registration proof with the number and expiry sent. Submit checks again against the store's record.
 */
export async function POST(request: NextRequest) {
  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const owner = await resolveOwnerSession(sid, extractSessionSignals(request))
  if (!owner) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const parsed = parseBody(Body, await request.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const { s3Key, docType, number, expiresOn } = parsed.data
  if (!isKybDoc(docType)) return NextResponse.json({ error: 'Unknown document type' }, { status: 400 })
  if (!s3Key.startsWith(kycKeyPrefix(owner.id))) return NextResponse.json({ error: 'Upload the document again.' }, { status: 403 })
  if (expiresOn && !isIsoDate(expiresOn)) return NextResponse.json({ error: 'Check the expiry date.' }, { status: 400 })
  if (docType !== 'pan_card' && docType !== 'gst_cert') {
    const problem = docNumberProblem(docType, number)
    if (problem) return NextResponse.json({ error: problem }, { status: 400 })
  }

  // Each check is an OCR call.
  if (!allow(`kyb-check:${owner.id}`, 12, 10 * 60_000))
    return NextResponse.json({ error: 'Too many checks in a short time. Try again in a few minutes, or leave it for a reviewer.' }, { status: 429 })

  const draft = await getDraft(owner.id)
  const analysis = await checkUpload(s3Key, docType, kybExpected(docType, draft?.data ?? {}, { number, expiresOn }))
  return NextResponse.json(analysis ? { analysis } : { analysis: null, reason: 'unreadable' })
}
