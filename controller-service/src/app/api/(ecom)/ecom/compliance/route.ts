import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { cookies } from 'next/headers'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/auth/owner-session'
import { extractSessionSignals } from '@/lib/auth/session-signals-request'
import { getOwnerTenants, hasService } from '@/lib/tenant-registry'
import { DOCS, GENERAL, SELLING_CATEGORIES, categoryDocs, cleanDocNumber, docProblem, todayIst } from '@controller/lib/catalog/compliance'
import { listComplianceDocuments, submitComplianceDocument } from '@controller/lib/catalog/compliance-docs'
import { alertDocumentSubmitted } from '@controller/lib/catalog/compliance-notify'
import { kycKeyPrefix } from '@controller/lib/catalog/kyc-upload'

export const dynamic = 'force-dynamic'

const Schema = z.object({
  tenantId: z.string().uuid(),
  docType: z.string().min(1).max(32),
  category: z.string().min(1).max(64),
  number: z.string().max(64).nullish(),
  expiresOn: z.string().max(10).nullish(),
  s3Key: z.string().min(1).max(512),
  fileName: z.string().max(255).nullish(),
})

// PUT: a licence or certificate sent from the console's Licences & certificates page: a renewal, a corrected copy of a
// rejected one, or one for a category the store starts selling. The file goes up first through
// /api/ecom/onboard/kyc-upload (the onboarding path and its file checks); here it is checked as the onboarding submit
// checks it, filed (a replacement keeps its category) and sent to the platform admin's review.
export async function PUT(request: NextRequest) {
  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const owner = await resolveOwnerSession(sid, extractSessionSignals(request))
  if (!owner) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const parsed = Schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  const b = parsed.data

  const tenant = (await getOwnerTenants(owner.id)).find(t => t.id === b.tenantId && t.status !== 'terminated')
  if (!tenant) return NextResponse.json({ error: 'Store not found' }, { status: 404 })
  if (!hasService(tenant, 'store')) return NextResponse.json({ error: 'Licences are kept for stores.' }, { status: 400 })

  const doc = Object.prototype.hasOwnProperty.call(DOCS, b.docType) ? DOCS[b.docType] : null
  if (!doc) return NextResponse.json({ error: 'Unknown document type' }, { status: 400 })

  const existing = (await listComplianceDocuments(tenant.id)).find(d => d.doc_type === b.docType)
  const knownCategory = b.category === GENERAL || SELLING_CATEGORIES.includes(b.category)
  if (!existing && !(knownCategory && categoryDocs(b.category).some(d => d.doc === b.docType)))
    return NextResponse.json({ error: `${b.category} does not ask for a ${doc.name}.` }, { status: 400 })

  if (!b.s3Key.startsWith(kycKeyPrefix(owner.id, b.docType)))
    return NextResponse.json({ error: 'Upload the document again, then save.' }, { status: 400 })
  const number = cleanDocNumber(b.number ?? '')
  const upload = { s3Key: b.s3Key, fileName: b.fileName ?? undefined, number, expiresOn: b.expiresOn ?? undefined }
  const problem = docProblem(doc, upload, todayIst())
  if (problem) return NextResponse.json({ error: problem }, { status: 400 })

  const row = await submitComplianceDocument(tenant.id, owner.id, {
    docType: b.docType,
    category: existing?.category ?? b.category,
    number: doc.numberLabel ? number : null,
    expiresOn: doc.expires ? (b.expiresOn ?? null) : null,
    s3Key: b.s3Key,
    fileName: b.fileName ?? null,
  })
  alertDocumentSubmitted(tenant, row, !!existing).catch(e => console.warn('[compliance] review alert not sent', e?.message || e))
  return NextResponse.json({ ok: true, document: { id: row.id, status: row.status } })
}
