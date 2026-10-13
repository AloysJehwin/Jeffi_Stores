import Fastify, { type FastifyRequest } from 'fastify'
import pg from 'pg'
import { randomBytes, randomUUID } from 'node:crypto'
import { ZodError } from 'zod'
import { RenderDocumentRequest, DocumentType, DocumentSettingsUpdate, DocumentFont } from '@jeffi/api-contracts'
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
import { appFromHost } from '@jeffi/tenancy'
import { publicRoutes } from './tenant/public.js'
import { adminRoutes } from './admin/index.js'

const url = process.env.DOCUMENTS_DATABASE_URL
if (!url) throw new Error('DOCUMENTS_DATABASE_URL is not set')
const db = new pg.Pool({ connectionString: url, max: 10 })
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

app.addHook('onRequest', async (req, reply) => {
  if (req.url.startsWith('/view/') || req.url.startsWith('/t/') || req.url === '/healthz' || /^\/designs\/[a-z0-9-]+\/thumbnail\.png$/.test(req.url)) return
  if (isPublicDocHost(req)) {
    if (!/^\/[^/]+(\/(pdf|json))?$/.test(req.url.split('?')[0])) return reply.code(404).send({ error: 'not_found' })
    return
  }
  const claims = verifyServiceToken(bearer(req as FastifyRequest))
  if (!claims) return reply.code(401).send({ error: 'unauthorized', message: 'Missing or invalid service token' })
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
    totals: { subtotal: d.totals.subtotal, cgst: d.totals.cgst, sgst: d.totals.sgst, igst: d.totals.igst, total: d.totals.total },
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

app.post<{ Params: { type: string } }>('/documents/:type', async (req, reply) => {
  const type = DocumentType.parse(req.params.type)
  const body = RenderDocumentRequest.parse(req.body)
  if (body.template && !resolveDesign(body.template)) return reply.code(400).send({ error: 'unknown_template', message: `Designs: ${DESIGNS.map(d => d.key).join(', ')}` })
  const { tenantId, apiKeyId } = req.claims
  const { design, branding } = await resolveBranding(db, tenantId, body.template, body.branding)
  const designKey = resolveDesign(design) ? design! : DEFAULT_DESIGN
  const totals = computeTotals(body)
  const id = randomUUID()
  const token = randomBytes(18).toString('base64url')
  const price = documentPriceInr(type)

  const debit = await wallet.debit({ tenantId, amountInr: price, category: 'document', externalRef: `doc:${id}`, note: `${type} render` })
  if (!debit.ok) return reply.code(402).send({ error: 'insufficient_balance', message: `Wallet balance ₹${debit.balance.toFixed(2)} is below ₹${price.toFixed(2)}. Top up ₹${debit.needed.toFixed(2)}.` })

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
  const row = (await db.query<DocRow>(`SELECT * FROM documents WHERE id=$1`, [id])).rows[0]
  return toApi(row)
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
