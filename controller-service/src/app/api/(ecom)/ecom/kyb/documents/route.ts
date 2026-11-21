import { NextRequest, NextResponse, after } from 'next/server'
import { ownerApi } from '@controller/lib/ecom/owner-api'
import { uploadKycDocument } from '@controller/lib/catalog/kyc-upload'
import { isIsoDate, todayIst } from '@controller/lib/catalog/compliance'
import { docNumberProblem, formatDocNumber, KYB_DOCS } from '@controller/lib/kyb/requirements'
import { getKybRecord, setGstCertKey, upsertKybDocument } from '@controller/lib/kyb/store'
import { analyzeDocument } from '@controller/lib/kyb/analyze'
import { loadKybView } from '@controller/lib/kyb/view'
import { allow } from '@controller/lib/kyb/throttle'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_SIZE = 5 * 1024 * 1024
const TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
/** How long the upload waits for the check before answering; a slower one finishes after the response. */
const WAIT_MS = 20_000

/**
 * A KYB document (multipart: file, docType, and number/expiresOn for a registration proof). It replaces the one on file,
 * goes to review, and is checked at once against the business's answers: the answer says what the check found.
 */
export async function POST(request: NextRequest) {
  const ctx = await ownerApi(request)
  if (ctx instanceof NextResponse) return ctx
  const form = await request.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })

  const docType = String(form.get('docType') ?? '')
  const spec = KYB_DOCS[docType]
  if (!spec) return NextResponse.json({ error: 'Unknown document type' }, { status: 400 })
  const file = form.get('file')
  if (!file || typeof file === 'string') return NextResponse.json({ error: 'Choose a file to upload.' }, { status: 400 })
  if (file.size > MAX_SIZE) return NextResponse.json({ error: 'The file is over 5 MB. Upload a smaller copy.' }, { status: 400 })
  if (!TYPES.includes(file.type)) return NextResponse.json({ error: 'Upload a PDF, JPG, PNG or WebP file.' }, { status: 400 })

  const kyc = await getKybRecord(ctx.tenant.id)
  // The PAN card and GST certificate are checked against the PAN and GSTIN in the business details.
  let number: string | null = null
  if (docType === 'pan_card') number = kyc?.pan ?? null
  else if (docType === 'gst_cert') number = kyc?.gst_number ?? null
  else {
    const typed = String(form.get('number') ?? '').trim()
    const problem = docNumberProblem(docType, typed)
    if (problem) return NextResponse.json({ error: problem, fields: { number: problem } }, { status: 400 })
    number = typed ? formatDocNumber(docType, typed) : null
  }
  const expiresOn = String(form.get('expiresOn') ?? '').trim() || null
  if (expiresOn && (!isIsoDate(expiresOn) || expiresOn < todayIst()))
    return NextResponse.json({ error: 'Enter a valid expiry date that hasn’t passed.', fields: { expiresOn: 'Check the date' } }, { status: 400 })

  if (!allow(`kyb-upload:${ctx.tenant.id}`, 12, 10 * 60_000))
    return NextResponse.json({ error: 'Too many uploads in a short time. Try again in a few minutes.' }, { status: 429 })

  const s3Key = await uploadKycDocument({
    buffer: Buffer.from(await file.arrayBuffer()),
    originalFilename: file.name,
    mimeType: file.type,
    ownerId: ctx.owner.id,
    docType,
  })
  const row = await upsertKybDocument(ctx.tenant.id, ctx.owner.id, { docType, number, expiresOn, s3Key, fileName: file.name })
  if (docType === 'gst_cert') await setGstCertKey(ctx.tenant.id, s3Key)

  const job = analyzeDocument(row, kyc)
  const finished = await Promise.race([job.then(() => true), new Promise<boolean>(r => setTimeout(() => r(false), WAIT_MS))])
  if (!finished) after(() => job.then(() => undefined))
  return NextResponse.json({ kyb: await loadKybView(ctx.tenant, ctx.owner.id) })
}
