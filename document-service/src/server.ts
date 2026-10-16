import Fastify, { type FastifyRequest } from 'fastify'
import pg from 'pg'
import { randomBytes, randomUUID } from 'node:crypto'
import { ZodError } from 'zod'
import { RenderDocumentRequest, DocumentType, DocumentSettingsUpdate, DocumentFont, BulkDocumentsRequest } from '@jeffi/api-contracts'
import { createJob, getJob, listJobs, listItems, cancelJob, retryJob, jobToApi, startWorker, BulkItemError, type BulkJobRow } from '@jeffi/bulk'
import archiver from 'archiver'
import { verifyServiceToken, bearer, type ServiceClaims } from '@jeffi/service-auth'
import { documentPriceInr } from '@jeffi/pricing'
import { getFinancialYear, generateInvoiceNumber } from '@jeffi/gst'
import * as wallet from '@jeffi/wallet'
import { computeTotals } from './totals.js'
import { readFile } from 'node:fs/promises'
import { renderDocument, resolveDesign, DESIGNS, DEFAULT_DESIGN, designList, fontList } from './designs/index.js'
import { sampleRequest } from './designs/sample.js'
import { getSettings, saveSettings, saveLogo, loadLogo, resolveBranding } from './designs/settings.js'
import { putPdf, getPdf, pdfUrl } from './storage.js'
import { appFromHost, mainPool, resolveServiceScope, scopeSql, inScope } from '@jeffi/tenancy'
import { publicRoutes } from './tenant/public.js'
import { adminRoutes } from './admin/index.js'

const url = process.env.DOCUMENTS_DATABASE_URL
if (!url) throw new Error('DOCUMENTS_DATABASE_URL is not set')
const db = mainPool(url, 10)
const PUBLIC_BASE = (process.env.PUBLIC_BASE_URL || 'http://localhost:3100').replace(/\/$/, '')
const PREFIX: Record<string, string> = { invoice: 'INV', quotation: 'QT', receipt: 'RCT', packing_slip: 'PS', label: 'LBL', purchase_order: 'PO' }

const app = Fastify({ logger: { level: process.env.LOG_LEVEL || 'info' } })
// Proxied POST/DELETE calls may carry content-type without a body.
app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
  if (!body || !String(body).trim()) return done(null, undefined)
  try { done(null, JSON.parse(String(body))) } catch (e: any) { e.statusCode = 400; done(e, undefined) }
})
declare module 'fastify' {
  interface FastifyRequest {
    claims: ServiceClaims
  }
}

const DOC_HOSTS = new Set(['invoice', 'quotation', 'purchaseorder'])
// Tenant document hosts (invoice-{slug}. etc.) are token-gated, not service-token-gated.
function isPublicDocHost(req: FastifyRequest): boolean {
  const fwd = req.headers['x-forwarded-host']
  const host = String((Array.isArray(fwd) ? fwd[0] : fwd) || req.headers.host || '')
  return DOC_HOSTS.has(appFromHost(host) ?? '')
}

const scope = await resolveServiceScope()

app.addHook('onRequest', async (req, reply) => {
  if (req.url.startsWith('/view/') || req.url.startsWith('/t/') || req.url === '/healthz' || /^\/designs\/[a-z0-9-]+\/thumbnail\.png$/.test(req.url)) return
  if (isPublicDocHost(req)) {
    if (!/^\/[^/]+(\/(pdf|json))?$/.test(req.url.split('?')[0])) return reply.code(404).send({ error: 'not_found' })
    return
  }
  const claims = verifyServiceToken(bearer(req as FastifyRequest))
  if (!claims) return reply.code(401).send({ error: 'unauthorized', message: 'Missing or invalid service token' })
  if (!inScope(scope, claims.tenantId)) return reply.code(403).send({ error: 'forbidden', message: 'This service belongs to another tenant' })
  req.claims = claims
})
app.setErrorHandler((err: any, _req, reply) => {
  if (err instanceof ZodError) return reply.code(400).send({ error: 'validation_error', message: 'Invalid request', details: err.issues })
  const status = err?.status ?? (err?.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 0)
  if (status) return reply.code(status).send({ error: err.status ? err.code ?? 'request_error' : 'bad_request', message: err.message })
  app.log.error(err)
  return reply.code(500).send({ error: 'internal_error', message: 'Something went wrong' })
})
app.get('/healthz', async () => ({ ok: true, service: 'documents' }))
await app.register(publicRoutes)
await app.register(adminRoutes)

interface DocRow {
  id: string
  tenant_id: string
  type: string
  number: string
  template: string
  payload: RenderDocumentRequest
  totals: any
  s3_key: string
  view_token: string
  price_inr: string
  reference: string | null
  created_at: string
}
async function toApi(d: DocRow) {
  return {
    id: d.id,
    type: d.type,
    number: d.number,
    template: d.template,
    totals: {
      subtotal: d.totals.subtotal, discount: d.totals.discount ?? 0, charges: d.totals.charges_total ?? 0, taxable: d.totals.taxable ?? d.totals.subtotal,
      cgst: d.totals.cgst, sgst: d.totals.sgst, igst: d.totals.igst, round_off: d.totals.round_off ?? 0, total: d.totals.total,
      amount_paid: d.totals.amount_paid ?? 0, balance_due: d.totals.balance_due ?? d.totals.total,
    },
    pdf_url: await pdfUrl(d.s3_key, `${PUBLIC_BASE}/d/${d.view_token}/pdf`),
    view_url: `${PUBLIC_BASE}/d/${d.view_token}`,
    price_inr: Number(d.price_inr),
    reference: d.reference,
    created_at: new Date(d.created_at).toISOString(),
  }
}

async function nextNumber(c: pg.PoolClient, tenantId: string, type: string): Promise<string> {
  const fy = getFinancialYear()
  const r = await c.query(
    `INSERT INTO document_sequences (tenant_id, type, financial_year, next_seq) VALUES ($1,$2,$3,2)
     ON CONFLICT (tenant_id, type, financial_year) DO UPDATE SET next_seq = document_sequences.next_seq + 1
     RETURNING next_seq - 1 AS seq`,
    [tenantId, type, fy]
  )
  return generateInvoiceNumber(PREFIX[type] ?? 'DOC', fy, Number(r.rows[0].seq))
}

const badTemplate = () => Object.assign(new Error(`Designs: ${DESIGNS.map(d => d.key).join(', ')}`), { status: 400, code: 'unknown_template' })

/** Render, store and record one document (debits the wallet; refunds if anything fails). */
async function createDocument(ctx: { tenantId: string; apiKeyId?: string | null }, type: DocumentType, body: RenderDocumentRequest): Promise<DocRow> {
  if (body.template && !resolveDesign(body.template)) throw badTemplate()
  const { tenantId, apiKeyId } = ctx
  const { design, branding } = await resolveBranding(db, tenantId, body.template, body.branding)
  const designKey = design && resolveDesign(design) ? design : DEFAULT_DESIGN
  const totals = computeTotals(body)
  const id = randomUUID()
  const token = randomBytes(18).toString('base64url')
  const price = documentPriceInr(type)

  const debit = await wallet.debit({ tenantId, amountInr: price, category: 'document', externalRef: `doc:${id}`, note: `${type} render` })
  if (!debit.ok) throw Object.assign(new Error(`Wallet balance ₹${debit.balance.toFixed(2)} is below ₹${price.toFixed(2)}. Top up ₹${debit.needed.toFixed(2)}.`), { status: 402, code: 'insufficient_balance' })

  const c = await db.connect()
  try {
    await c.query('BEGIN')
    const number = body.number ?? (await nextNumber(c, tenantId, type))
    const key = `${tenantId}/${type}/${id}.pdf`
    const pdf = await renderDocument(designKey, type, body, totals, number, `${PUBLIC_BASE}/d/${token}`, branding)
    await putPdf(key, pdf)
    await c.query(
      `INSERT INTO documents (id, tenant_id, api_key_id, type, number, template, payload, totals, s3_key, view_token, price_inr, reference)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [id, tenantId, apiKeyId ?? null, type, number, designKey, body, totals, key, token, price, body.reference ?? null]
    )
    await c.query('COMMIT')
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    await wallet.trueUp({ tenantId, amountInr: 0, externalRef: `doc:${id}`, note: `refund: ${type} render failed` })
    throw e
  } finally {
    c.release()
  }
  return (await db.query<DocRow>(`SELECT * FROM documents WHERE id=$1`, [id])).rows[0]
}

app.post<{ Params: { type: string } }>('/documents/:type', async req => {
  const type = DocumentType.parse(req.params.type)
  return toApi(await createDocument(req.claims, type, RenderDocumentRequest.parse(req.body)))
})

// ── bulk ──
// Item = job defaults (type/template/branding/seller) merged under the item, validated up front.
function bulkInputs(b: BulkDocumentsRequest) {
  const errors: { index: number; message: string }[] = []
  const inputs = b.items.map((raw, index) => {
    const type = DocumentType.safeParse(raw.type ?? b.type)
    const body = RenderDocumentRequest.safeParse({
      ...raw, type: undefined,
      template: raw.template ?? b.template,
      branding: raw.branding ?? b.branding,
      seller: raw.seller ?? b.seller,
    })
    if (!type.success) errors.push({ index, message: 'type is required (job or item): invoice, quotation, receipt, packing_slip, label or purchase_order' })
    else if (!body.success) errors.push({ index, message: body.error.issues.map(i => `${i.path.join('.') || 'item'}: ${i.message}`).join('; ') })
    else if (body.data.template && !resolveDesign(body.data.template)) errors.push({ index, message: `unknown template '${body.data.template}'` })
    return { type: type.data, body: body.data }
  })
  return { inputs, errors }
}

const bulkItemOut = async (it: { seq: number; status: string; error: string | null; input: any; result_id: string | null }, docs: Map<string, DocRow>) => {
  const d = it.result_id ? docs.get(it.result_id) : undefined
  return { seq: it.seq, status: it.status, error: it.error, reference: it.input?.body?.reference ?? null, result: d ? await toApi(d) : null }
}
const withZip = (j: BulkJobRow) => ({ ...jobToApi(j), zip_url: j.succeeded > 0 ? `/documents/bulk/${j.id}/zip` : undefined })

app.post('/documents/bulk', { bodyLimit: 10_000_000 }, async (req, reply) => {
  const b = BulkDocumentsRequest.parse(req.body)
  const { inputs, errors } = bulkInputs(b)
  if (errors.length) return reply.code(400).send({ error: 'validation_error', message: `${errors.length} item(s) are invalid`, details: errors.slice(0, 50) })
  const job = await createJob(db, { kind: 'documents', tenantId: req.claims.tenantId, apiKeyId: req.claims.apiKeyId, reference: b.reference, inputs })
  return reply.code(202).send(withZip(job))
})
app.get<{ Querystring: { limit?: string; cursor?: string } }>('/documents/bulk', async req => {
  const r = await listJobs(db, req.claims.tenantId, 'documents', { limit: Number(req.query.limit), cursor: req.query.cursor })
  return { ...r, items: r.items.map(j => ({ ...j, zip_url: j.succeeded > 0 ? `/documents/bulk/${j.id}/zip` : undefined })) }
})
async function bulkJob(req: FastifyRequest<{ Params: { id: string } }>) {
  const job = await getJob(db, req.claims.tenantId, 'documents', req.params.id)
  if (!job) throw Object.assign(new Error('Bulk job not found'), { status: 404, code: 'not_found' })
  return job
}
app.get<{ Params: { id: string } }>('/documents/bulk/:id', async req => withZip(await bulkJob(req)))
app.get<{ Params: { id: string }; Querystring: { status?: string; cursor?: string; limit?: string } }>('/documents/bulk/:id/items', async req => {
  const job = await bulkJob(req)
  const { rows, next_cursor } = await listItems(db, job.id, { status: req.query.status, cursor: req.query.cursor, limit: Number(req.query.limit) })
  const ids = rows.map(r => r.result_id).filter(Boolean)
  const docs = new Map((await db.query<DocRow>(`SELECT * FROM documents WHERE id = ANY($1)`, [ids])).rows.map(d => [d.id, d]))
  return { items: await Promise.all(rows.map(r => bulkItemOut(r, docs))), next_cursor }
})
app.post<{ Params: { id: string } }>('/documents/bulk/:id/cancel', async req => withZip(await cancelJob(db, await bulkJob(req))))
app.post<{ Params: { id: string } }>('/documents/bulk/:id/retry', async req => withZip(await retryJob(db, await bulkJob(req))))
// Streamed on demand from storage — nothing extra stored, so it can't go stale.
app.get<{ Params: { id: string } }>('/documents/bulk/:id/zip', async (req, reply) => {
  const job = await bulkJob(req)
  const docs = (await db.query<DocRow>(
    `SELECT d.* FROM bulk_job_items i JOIN documents d ON d.id = i.result_id WHERE i.job_id=$1 AND i.status='done' ORDER BY i.seq`, [job.id])).rows
  if (!docs.length) return reply.code(404).send({ error: 'not_found', message: 'No documents in this job yet' })
  const zip = archiver('zip', { zlib: { level: 1 } })
  reply.header('content-type', 'application/zip').header('content-disposition', `attachment; filename="documents-${job.id.slice(0, 8)}.zip"`)
  void (async () => {
    const used = new Set<string>()
    for (const d of docs) {
      let name = `${d.number.replace(/[\\/:*?"<>|]/g, '-')}.pdf`
      if (used.has(name)) name = `${d.number.replace(/[\\/:*?"<>|]/g, '-')}-${d.id.slice(0, 6)}.pdf`
      used.add(name)
      zip.append(await getPdf(d.s3_key), { name })
    }
    await zip.finalize()
  })().catch(e => zip.destroy(e))
  return reply.send(zip)
})

app.get<{ Params: { id: string } }>('/documents/:id', async (req, reply) => {
  const r = await db.query<DocRow>(`SELECT * FROM documents WHERE id=$1 AND tenant_id=$2`, [req.params.id, req.claims.tenantId])
  if (!r.rows[0]) return reply.code(404).send({ error: 'not_found', message: 'Document not found' })
  return toApi(r.rows[0])
})
app.get<{ Params: { id: string } }>('/documents/:id/pdf', async (req, reply) => {
  const r = await db.query<DocRow>(`SELECT * FROM documents WHERE id=$1 AND tenant_id=$2`, [req.params.id, req.claims.tenantId])
  if (!r.rows[0]) return reply.code(404).send({ error: 'not_found', message: 'Document not found' })
  reply.header('content-type', 'application/pdf').header('content-disposition', `inline; filename="${r.rows[0].number.replace(/\//g, '-')}.pdf"`)
  return getPdf(r.rows[0].s3_key)
})
app.get<{ Querystring: { limit?: string; cursor?: string; type?: string } }>('/documents', async req => {
  const limit = Math.min(Number(req.query.limit ?? 50), 200)
  const r = await db.query<DocRow>(
    `SELECT * FROM documents WHERE tenant_id=$1 AND ($2::text IS NULL OR type=$2) AND ($3::timestamptz IS NULL OR created_at < $3) ORDER BY created_at DESC LIMIT $4`,
    [req.claims.tenantId, req.query.type ?? null, req.query.cursor ?? null, limit]
  )
  const items = await Promise.all(r.rows.map(toApi))
  return { items, next_cursor: items.length === limit ? items[items.length - 1].created_at : null }
})

// ── designs + workspace document settings ──
const THUMBS = new URL('../public/designs/', import.meta.url)
app.get('/designs', async () => ({
  designs: designList().map(d => ({ ...d, thumbnail_url: `/designs/${d.key}/thumbnail.png` })),
  fonts: fontList(),
  default: DEFAULT_DESIGN,
}))
app.get<{ Params: { key: string } }>('/designs/:key/thumbnail.png', async (req, reply) => {
  if (!DESIGNS.some(d => d.key === req.params.key)) return reply.code(404).send({ error: 'not_found' })
  const png = await readFile(new URL(`${req.params.key}.png`, THUMBS)).catch(() => null)
  if (!png) return reply.code(404).send({ error: 'not_found' })
  return reply.header('content-type', 'image/png').header('cache-control', 'public, max-age=86400').send(png)
})
app.get<{ Params: { key: string; type: string }; Querystring: { accent?: string; font?: string } }>('/designs/:key/preview/:type', async (req, reply) => {
  const type = DocumentType.parse(req.params.type)
  if (!resolveDesign(req.params.key)) return reply.code(404).send({ error: 'unknown_template', message: `Designs: ${DESIGNS.map(d => d.key).join(', ')}` })
  const { branding } = await resolveBranding(db, req.claims.tenantId, null, {
    accent: req.query.accent || undefined, font: req.query.font ? DocumentFont.parse(req.query.font) : undefined,
  })
  const sample = sampleRequest(type)
  const pdf = await renderDocument(req.params.key, type, sample, computeTotals(sample), 'PREVIEW/0001', `${PUBLIC_BASE}/d/preview`, branding)
  return reply.header('content-type', 'application/pdf').header('content-disposition', `inline; filename="${req.params.key}-${type}.pdf"`).send(pdf)
})

const settingsOut = (s: Awaited<ReturnType<typeof getSettings>>) => ({ design: s.design, accent: s.accent, font: s.font, has_logo: !!s.logo_key })
app.get('/settings', async req => settingsOut(await getSettings(db, req.claims.tenantId)))
app.put('/settings', async req => settingsOut(await saveSettings(db, req.claims.tenantId, DocumentSettingsUpdate.parse(req.body ?? {}))))
app.get('/settings/logo', async (req, reply) => {
  const logo = await loadLogo((await getSettings(db, req.claims.tenantId)).logo_key)
  if (!logo) return reply.code(404).send({ error: 'not_found', message: 'No logo set' })
  return reply.header('content-type', 'image/png').header('cache-control', 'no-store').send(logo)
})
// Body: { data: base64 image | null } — null removes the logo.
app.post<{ Body: { data?: string | null } }>('/settings/logo', { bodyLimit: 2_000_000 }, async req => {
  const data = req.body?.data
  const raw = data ? Buffer.from(data.replace(/^data:[^,]+,/, ''), 'base64') : null
  if (raw && raw.length > 1_000_000) throw Object.assign(new Error('Logo must be 1 MB or smaller'), { status: 400, code: 'validation_error' })
  return settingsOut(await saveLogo(db, req.claims.tenantId, raw))
})

// ── token viewer (no auth) ──
app.get<{ Params: { token: string } }>('/view/:token', async (req, reply) => {
  const r = await db.query<DocRow>(`SELECT * FROM documents WHERE view_token=$1`, [req.params.token])
  const d = r.rows[0]
  if (!d) return reply.code(404).type('text/html').send('<h1>Document not found</h1>')
  // Relative fallback: the viewer is served on the public host, which also serves /d/:token/pdf.
  const pdf = esc(await pdfUrl(d.s3_key, `/d/${d.view_token}/pdf`))
  reply.type('text/html; charset=utf-8')
  const number = esc(d.number)
  return `<!doctype html><meta charset="utf-8"><title>${number}</title><style>body{margin:0;font-family:system-ui;background:#f5f0e6}header{padding:12px 20px;display:flex;justify-content:space-between;align-items:center;background:#fffdf7;border-bottom:1px solid #e3dacb}a{color:#a9552f;font-weight:600}iframe{width:100%;height:calc(100vh - 53px);border:0}</style><header><strong>${esc(TITLES[d.type] ?? d.type)} · ${number}</strong><a href="${pdf}" download>Download PDF</a></header><iframe src="${pdf}"></iframe>`
})
app.get<{ Params: { token: string } }>('/view/:token/pdf', async (req, reply) => {
  const r = await db.query<DocRow>(`SELECT s3_key, number FROM documents WHERE view_token=$1`, [req.params.token])
  if (!r.rows[0]) return reply.code(404).send('not found')
  reply.header('content-type', 'application/pdf').header('content-disposition', `inline; filename="${r.rows[0].number.replace(/\//g, '-')}.pdf"`)
  return getPdf(r.rows[0].s3_key)
})

const TITLES: Record<string, string> = { invoice: 'Invoice', quotation: 'Quotation', receipt: 'Receipt', packing_slip: 'Packing slip', label: 'Shipping label', purchase_order: 'Purchase order' }
const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)

const port = Number(process.env.PORT || 3102)
await app.listen({ port, host: '0.0.0.0' })

startWorker(db, 'documents', async (item, job) => {
  const { type, body } = item.input as { type: DocumentType; body: RenderDocumentRequest }
  try {
    const d = await createDocument({ tenantId: job.tenant_id, apiKeyId: job.api_key_id }, type, body)
    return { resultId: d.id, spentInr: Number(d.price_inr), usage: 'documents' }
  } catch (e: any) {
    if (e?.code === 'insufficient_balance') throw new BulkItemError(e.message, { stop: true })
    if (e?.status === 400) throw new BulkItemError(e.message)
    throw e
  }
}, { concurrency: Number(process.env.DOCUMENT_BULK_CONCURRENCY || 4), sequential: true, log: (m, e) => app.log.error({ err: e }, m), where: (c, p) => scopeSql(scope, c, p) })
