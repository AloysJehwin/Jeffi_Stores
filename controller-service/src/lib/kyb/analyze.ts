import 'server-only'
import { getKycDocumentStream } from '@controller/lib/catalog/kyc-upload'
import { todayIst } from '@controller/lib/catalog/compliance'
import { analyzeText, type DocAnalysis, type Expected } from './extract'
import { readDocumentText } from './read'
import { entityOf, KYB_CATEGORY } from './requirements'
import { getKybRecord, listAllDocuments, markAnalysisPending, saveAnalysis, type KybDocRow, type KybRecord } from './store'

// The automatic check on a document on file (KYB or a selling licence): read its text, compare it with what the owner
// typed, store the verdict on the row. A reviewer still has the last word; the check tells the owner at once when a
// number or name doesn't match, and tells the reviewer what was read.

/** What a document should say, from the business's answers. */
export function expectedFor(doc: Pick<KybDocRow, 'doc_type' | 'doc_number' | 'expires_on' | 'category'>, kyc: KybRecord | null): Expected {
  const legal = kyc?.business_name ?? null
  const trade = kyc?.trade_name ?? null
  const entity = entityOf(kyc)
  if (doc.doc_type === 'pan_card')
    // A proprietorship's PAN is the proprietor's own, in their name.
    return { number: kyc?.pan ?? null, names: entity === 'proprietor' ? [kyc?.authorized_name, legal] : [legal, trade], entity }
  if (doc.doc_type === 'gst_cert') return { number: kyc?.gst_number ?? null, names: [legal, trade], entity }
  const proprietor = entity === 'proprietor' ? [kyc?.authorized_name] : []
  return { number: doc.doc_number, names: [legal, trade, ...proprietor], expiresOn: doc.expires_on, entity }
}

async function bytes(s3Key: string): Promise<{ buf: Buffer; mime: string }> {
  const { body, contentType } = await getKycDocumentStream(s3Key)
  const chunks: Uint8Array[] = []
  const reader = body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  const ext = s3Key.split('.').pop()?.toLowerCase()
  const mime = contentType !== 'application/octet-stream' ? contentType : ext === 'pdf' ? 'application/pdf' : `image/${ext === 'jpg' ? 'jpeg' : ext}`
  return { buf: Buffer.concat(chunks), mime }
}

/**
 * The check on a file that isn't on a store's record yet (the onboarding wizard's uploads, before the store exists):
 * read and compared, nothing stored. Null when the file couldn't be read.
 */
export async function checkUpload(s3Key: string, docType: string, expected: Expected): Promise<DocAnalysis | null> {
  try {
    const { buf, mime } = await bytes(s3Key)
    const read = await readDocumentText(buf, mime)
    if (read.error) return null
    return { ...analyzeText(docType, read.text, expected, read.source, todayIst()), engine: read.engine ?? undefined }
  } catch (e) {
    console.error('[kyb] upload check failed', docType, (e as Error)?.message)
    return null
  }
}

/** Runs the check on one document and stores it. Never throws: a failure is stored as one, for a reviewer. */
export async function analyzeDocument(doc: KybDocRow, kyc?: KybRecord | null): Promise<DocAnalysis | null> {
  const profile = kyc === undefined ? await getKybRecord(doc.tenant_id).catch(() => null) : kyc
  try {
    const { buf, mime } = await bytes(doc.s3_key)
    const read = await readDocumentText(buf, mime)
    if (read.error) {
      await saveAnalysis(doc.tenant_id, doc.id, doc.s3_key, 'failed', null)
      return null
    }
    const analysis = { ...analyzeText(doc.doc_type, read.text, expectedFor(doc, profile), read.source, todayIst()), engine: read.engine ?? undefined }
    await saveAnalysis(doc.tenant_id, doc.id, doc.s3_key, 'done', analysis)
    return analysis
  } catch (e) {
    console.error('[kyb] check failed', doc.doc_type, (e as Error)?.message)
    await saveAnalysis(doc.tenant_id, doc.id, doc.s3_key, 'failed', null).catch(() => {})
    return null
  }
}

/**
 * Whether a document's stored check compared against what the business says now (a later edit to the name, PAN or
 * GSTIN makes it out of date).
 */
export function analysisCurrent(doc: KybDocRow, kyc: KybRecord | null): boolean {
  if (!doc.analysis) return true // nothing stored that could be out of date
  const now = expectedFor(doc, kyc)
  const was = doc.analysis.expected ?? {}
  const norm = (e: Expected) => JSON.stringify([e.number ?? null, (e.names ?? []).filter(Boolean), e.expiresOn ?? null, e.entity ?? null])
  return norm(now) === norm(was)
}

/**
 * Marks the store's documents to check again and returns the job that checks them: the ones whose check is out of
 * date or failed (every one with `all`), KYB only unless `licences`. Marking first lets the console show them as being
 * checked while the job runs after the response.
 */
export async function queueRecheck(tenantId: string, opts: { all?: boolean; licences?: boolean } = {}): Promise<{ count: number; run: () => Promise<void> }> {
  const kyc = await getKybRecord(tenantId)
  // Never checked, failed, or checked against answers that have since changed.
  const due = (d: KybDocRow) => !d.analysis || d.analysis_status === 'failed' || !analysisCurrent(d, kyc)
  const docs = (await listAllDocuments(tenantId)).filter(
    d => (opts.licences || d.category === KYB_CATEGORY) && d.status !== 'approved' && (opts.all || due(d))
  )
  for (const d of docs) await markAnalysisPending(tenantId, d.id)
  return {
    count: docs.length,
    run: async () => {
      for (const d of docs) await analyzeDocument(d, kyc)
    },
  }
}
