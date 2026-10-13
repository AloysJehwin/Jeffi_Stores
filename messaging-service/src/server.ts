import Fastify, { type FastifyRequest } from 'fastify'
import formbody from '@fastify/formbody'
import { randomUUID } from 'node:crypto'
import { ZodError } from 'zod'
import { SendMessageRequest, BatchMessageRequest, BulkMessagesRequest, UpsertTemplateRequest, UpsertLibraryTemplateRequest, UpdateLibraryTemplateRequest, TemplateQuery, Channel } from '@jeffi/api-contracts'
import { verifyServiceToken, bearer, type ServiceClaims } from '@jeffi/service-auth'
import { usdToInr } from '@jeffi/pricing'
import * as wallet from '@jeffi/wallet'
import { db, one } from './db.js'
import { sendMessage, getMessage, resolveTemplate, systemVars, toApi as msgToApi, SendError, type MessageRow } from './send.js'
import { listTemplates, upsertTemplate, archiveTemplate, toApi as tplToApi } from './templates.js'
import * as tpl from './templates-v2.js'
import { CATALOG, WA_APPROVED_SIDS } from '../seed/catalog.js'
import * as twContent from './providers/twilio-content.js'
import { priceUsd } from './providers/twilio.js'
import { poolsForTenant } from './pools.js'
import * as wa from './wa-approval.js'
import { render as renderVars, missingKeys } from './render.js'
import { wrapEmail } from './mail-shell.js'
import { randomBytes } from 'node:crypto'
import { createJob, getJob, listJobs, listItems, cancelJob, retryJob, jobToApi, startWorker, BulkItemError } from '@jeffi/bulk'

export const app = Fastify({ logger: { level: process.env.LOG_LEVEL || 'info' } })

// Accept an empty JSON body (DELETE / body-less POST with Content-Type: application/json).
app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
  try { done(null, body ? JSON.parse(body as string) : {}) } catch (e: any) { e.statusCode = 400; done(e, undefined) }
})
await app.register(formbody)

declare module 'fastify' {
  interface FastifyRequest {
    claims: ServiceClaims
  }
}

// Every non-webhook route needs a gateway-issued service token.
app.addHook('onRequest', async (req, reply) => {
  if (req.url.startsWith('/webhooks') || req.url.startsWith('/s/') || req.url === '/healthz') return
  const claims = verifyServiceToken(bearer(req as FastifyRequest))
  if (!claims) return reply.code(401).send({ error: 'unauthorized', message: 'Missing or invalid service token' })
  req.claims = claims
})

app.setErrorHandler((err: any, _req, reply) => {
  if (err instanceof SendError) return reply.code(err.status).send({ error: err.code, message: err.message, details: err.details })
  if (err instanceof ZodError) return reply.code(400).send({ error: 'validation_error', message: 'Invalid request', details: err.issues })
  if (err?.status) return reply.code(err.status).send({ error: 'request_error', message: err.message })
  app.log.error(err)
  return reply.code(500).send({ error: 'internal_error', message: 'Something went wrong' })
})

app.get('/healthz', async () => ({ ok: true, service: 'messaging' }))

// ── messages ──
app.post('/messages', async req => {
  const body = SendMessageRequest.parse(req.body)
  const { tenantId, tenantSlug, apiKeyId, internal } = req.claims
  return msgToApi(await sendMessage({ tenantId, tenantSlug, apiKeyId, internal, space: spaceOf(req) }, body))
})

app.post('/messages/batch', async req => {
  const body = BatchMessageRequest.parse(req.body)
  const { tenantId, tenantSlug, apiKeyId } = req.claims
  const batchId = randomUUID()
  const rejected: { to: string; reason: string }[] = []
  let accepted = 0
  // Sequential on purpose: provider rate limits + wallet row lock. A worker queue comes with scale.
  for (const r of body.recipients) {
    try {
      const m = await sendMessage({ tenantId, tenantSlug, apiKeyId, batchId, space: spaceOf(req) }, {
        channel: body.channel,
        to: r.to,
        template: body.template,
        subject: body.subject,
        variables: { ...(body.variables ?? {}), ...(r.variables ?? {}) },
        reference: r.reference,
        media_url: r.media_url ?? body.media_url,
        button_url: r.button_url ?? body.button_url,
      } as SendMessageRequest)
      if (m.status === 'sent') accepted++
      else rejected.push({ to: r.to, reason: m.error ?? m.status })
    } catch (e: any) {
      rejected.push({ to: r.to, reason: e instanceof SendError ? e.code : 'error' })
      if (e instanceof SendError && e.code === 'insufficient_balance') break
    }
  }
  return { batch_id: batchId, accepted, rejected }
})

// ── bulk (async; worker below) ──
app.post('/messages/bulk', { bodyLimit: 10_000_000 }, async (req, reply) => {
  const b = BulkMessagesRequest.parse(req.body)
  const { tenantId, tenantSlug, apiKeyId } = req.claims
  if (!(await resolveTemplate(tenantId, b.channel, b.template, spaceOf(req)))) throw new SendError(404, 'template_not_found', `No ${b.channel} template '${b.template}'`)
  const inputs = b.recipients.map(r => ({
    channel: b.channel, to: r.to, template: b.template, subject: b.subject,
    variables: { ...(b.variables ?? {}), ...(r.variables ?? {}) }, reference: r.reference,
    media_url: r.media_url ?? b.media_url, button_url: r.button_url ?? b.button_url,
  }))
  const job = await createJob(db, { kind: 'messages', tenantId, apiKeyId, reference: b.reference, inputs,
    options: { channel: b.channel, template: b.template, space: spaceOf(req), tenantSlug } })
  return reply.code(202).send(jobToApi(job))
})
app.get<{ Querystring: { limit?: string; cursor?: string } }>('/messages/bulk', async req =>
  listJobs(db, req.claims.tenantId, 'messages', { limit: Number(req.query.limit), cursor: req.query.cursor }))
async function bulkJob(req: FastifyRequest<{ Params: { id: string } }>) {
  const job = await getJob(db, req.claims.tenantId, 'messages', req.params.id)
  if (!job) throw new SendError(404, 'not_found', 'Bulk job not found')
  return job
}
app.get<{ Params: { id: string } }>('/messages/bulk/:id', async req => jobToApi(await bulkJob(req)))
app.get<{ Params: { id: string }; Querystring: { status?: string; cursor?: string; limit?: string } }>('/messages/bulk/:id/items', async req => {
  const job = await bulkJob(req)
  const { rows, next_cursor } = await listItems(db, job.id, { status: req.query.status, cursor: req.query.cursor, limit: Number(req.query.limit) })
  const ids = rows.map(r => r.result_id).filter(Boolean)
  const msgs = new Map((await db.query<MessageRow>(`SELECT * FROM messages WHERE id = ANY($1)`, [ids])).rows.map(m => [m.id, m]))
  return {
    items: rows.map(r => ({ seq: r.seq, status: r.status, error: r.error, reference: r.input?.reference ?? null, to: r.input?.to,
      result: r.result_id && msgs.get(r.result_id) ? msgToApi(msgs.get(r.result_id)!) : null })),
    next_cursor,
  }
})
app.post<{ Params: { id: string } }>('/messages/bulk/:id/cancel', async req => jobToApi(await cancelJob(db, await bulkJob(req))))
app.post<{ Params: { id: string } }>('/messages/bulk/:id/retry', async req => jobToApi(await retryJob(db, await bulkJob(req))))

app.get<{ Params: { id: string } }>('/messages/:id', async (req, reply) => {
  const m = await getMessage(req.claims.tenantId, req.params.id)
  if (!m) return reply.code(404).send({ error: 'not_found', message: 'Message not found' })
  return msgToApi(m)
})

app.get<{ Querystring: { limit?: string; cursor?: string; channel?: string; batch_id?: string } }>('/messages', async req => {
  const limit = Math.min(Number(req.query.limit ?? 50), 200)
  const rows = await db.query<MessageRow>(
    `SELECT * FROM messages WHERE tenant_id=$1 AND ($2::text IS NULL OR channel=$2) AND ($3::timestamptz IS NULL OR created_at < $3)
       AND ($5::uuid IS NULL OR batch_id=$5)
     ORDER BY created_at DESC LIMIT $4`,
    [req.claims.tenantId, req.query.channel ?? null, req.query.cursor ?? null, limit, /^[0-9a-f-]{36}$/i.test(req.query.batch_id ?? '') ? req.query.batch_id : null]
  )
  const items = rows.rows.map(msgToApi)
  return { items, next_cursor: items.length === limit ? items[items.length - 1].created_at : null }
})

// ── templates ──
app.get('/templates', async req => {
  const qs = TemplateQuery.parse(req.query)
  return { items: (await listTemplates(req.claims.tenantId, qs.channel, qs.include_system)).map(tplToApi) }
})
app.post('/templates', async req => {
  const body = UpsertTemplateRequest.parse(req.body)
  return tplToApi((await upsertTemplate(req.claims.tenantId, body))!)
})
app.delete<{ Params: { channel: string; slug: string } }>('/templates/:channel/:slug', async (req, reply) => {
  const n = await archiveTemplate(req.claims.tenantId, Channel.parse(req.params.channel), req.params.slug)
  if (!n) return reply.code(404).send({ error: 'not_found', message: 'Template not found' })
  return { ok: true }
})

// ── templates v2 (three-level: family → template → variant → version) ──

const poolFor = (req: FastifyRequest) => poolsForTenant(req.claims.tenantId)
// Store (admin + store sends) and Messaging API (console + API keys) keep separate template copies.
const spaceOf = (req: FastifyRequest): tpl.Space => req.claims.space ?? (req.claims.service === 'public-api' ? 'api' : 'store')

app.get<{ Params: { channel: string; slug: string }; Querystring: { locale?: string } }>(
  '/v2/templates/:channel/:slug',
  async (req, reply) => {
    const { pools } = await poolFor(req)
    const t = await tpl.findBySlugWithDefaults(pools, req.claims.tenantId, Channel.parse(req.params.channel), req.params.slug, req.query.locale ?? 'en', spaceOf(req))
    if (!t) return reply.code(404).send({ error: 'not_found' })
    return tpl.toApi(t)
  }
)

app.get<{ Params: { id: string } }>('/v2/templates/:id/versions', async req => {
  const { pool } = await poolFor(req)
  const t = await tpl.findById(pool, req.claims.tenantId, req.params.id, spaceOf(req))
  if (!t?.variant) return { items: [] }
  return { items: await tpl.listVersions(pool, t.variant.id) }
})

app.get<{ Querystring: { channel?: string } }>('/v2/templates', async req => {
  const { pools } = await poolFor(req)
  const items = await tpl.listTemplatesWithDefaults(pools, req.claims.tenantId, req.query.channel, spaceOf(req))
  return { items }
})

// API-key callers get strict validation; the dashboards post the editor's richer shape.
const upsertBody = (req: FastifyRequest, partial = false) =>
  (req.claims.service === 'public-api' ? (partial ? UpdateLibraryTemplateRequest : UpsertLibraryTemplateRequest).parse(req.body) : req.body) as tpl.UpsertInput

app.post('/v2/templates', async req => {
  const { pool } = await poolFor(req)
  return tpl.toApi(await tpl.upsertTemplate(pool, req.claims.tenantId, upsertBody(req), spaceOf(req)))
})

app.delete<{ Params: { channel: string; slug: string } }>('/v2/templates/:channel/:slug', async (req, reply) => {
  const { pool } = await poolFor(req)
  const own = await tpl.findBySlug(pool, req.claims.tenantId, Channel.parse(req.params.channel), req.params.slug, 'en', spaceOf(req))
  if (!own) return reply.code(404).send({ error: 'not_found', message: 'No template of yours with that slug (standard templates cannot be deleted)' })
  await tpl.archiveTemplate(pool, req.claims.tenantId, own.template.id, spaceOf(req))
  return { ok: true }
})

app.put<{ Params: { id: string } }>('/v2/templates/:id', async (req, reply) => {
  const { pool } = await poolFor(req)
  // A tenant's first save of a standard template forks it into the tenant's own DB.
  const existing = await tpl.findById(pool, req.claims.tenantId, req.params.id, spaceOf(req))
    ?? (req.claims.tenantId !== tpl.PLATFORM_TENANT_ID ? await tpl.findById(db, tpl.PLATFORM_TENANT_ID, req.params.id) : null)
  if (!existing) return reply.code(404).send({ error: 'not_found' })
  const input: tpl.UpsertInput = {
    ...(upsertBody(req, true) as any),
    slug: existing.family.slug,
    channel: existing.template.channel as any,
    name: (req.body as any).name ?? existing.family.name,
  }
  return tpl.toApi(await tpl.upsertTemplate(pool, req.claims.tenantId, input, spaceOf(req)))
})

app.post<{ Params: { id: string }; Body: { versionId: string } }>(
  '/v2/templates/:id/publish',
  async (req, reply) => {
    const { pool } = await poolFor(req)
    const t = await tpl.findById(pool, req.claims.tenantId, req.params.id, spaceOf(req))
    if (!t?.variant) return reply.code(404).send({ error: 'not_found' })
    const ok = await tpl.publishVersion(pool, req.claims.tenantId, t.variant.id, req.body.versionId, spaceOf(req))
    if (!ok) return reply.code(404).send({ error: 'version_not_found' })
    return { ok: true }
  }
)

const SAMPLES: Record<string, string> = {
  customer_name: 'Priya Sharma', customer_first_name: 'Priya', first_name: 'Priya', store_name: 'Your Store',
  order_number: 'JS-10234', total: '₹2,499', amount: '₹2,499', product_name: 'Classic Cotton Kurta',
  code: '482913', otp: '482913', ttl_minutes: '10', courier: 'Delhivery', awb: '1234567890123',
  short_url: 'https://jeffi.st/x1y2z3', order_url: 'https://example.com/account/orders/JS-10234',
  product_url: 'https://example.com/p/classic-cotton-kurta', vault_url: 'https://example.com/vault/abc',
  discount: '20%', festival: 'Diwali', ticket: 'T-4521', items: '2 items', reason: '',
}
const sampleFor = (key: string) => SAMPLES[key] ?? (/^\d+$/.test(key) ? `Sample ${key}` : `[${key.replace(/_/g, ' ')}]`)

app.post<{ Body: { channel: string; slug: string; locale?: string; versionId?: string; variables?: Record<string, any> } }>(
  '/v2/templates/preview',
  async (req, reply) => {
    const { pools } = await poolFor(req)
    const t = await tpl.findBySlugWithDefaults(pools, req.claims.tenantId, req.body.channel, req.body.slug, req.body.locale ?? 'en', spaceOf(req))
    if (!t?.version) return reply.code(404).send({ error: 'not_found' })
    const given = { ...(await systemVars(req.claims.tenantId)), ...(req.body.variables ?? {}) }
    // Preview = sample data: anything the caller didn't supply gets a sample value.
    const missing = [...new Set([...missingKeys(t.version.subject ?? '', given), ...missingKeys(t.version.body, given)])]
    const vars = { ...Object.fromEntries(missing.map(k => [k, sampleFor(k)])), ...given }
    const isEmail = t.template.channel === 'email'
    const subject = t.version.subject ? renderVars(t.version.subject, vars) : null
    let body = renderVars(t.version.body, vars, isEmail)
    const b = req.body as any
    if (isEmail && t.version.layout !== 'none') body = wrapEmail(body, { brand: b.brand ?? req.claims.tenantSlug, kicker: b.kicker, footerContact: b.footer_contact })
    return { channel: t.template.channel, subject, body, missing, sampled: missing }
  }
)

app.post<{ Body: { channel: string; subject?: string; body: string; variables?: Record<string, any> } }>(
  '/v2/templates/validate',
  async req => {
    const b = req.body
    const vars = b.variables ?? {}
    const missing = [...new Set([...missingKeys(b.subject ?? '', vars), ...missingKeys(b.body, vars)])]
    const warnings: string[] = []
    if (b.channel === 'sms') {
      const hasEmoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(b.body)
      const limit = hasEmoji ? 70 : 160
      const segments = Math.max(1, Math.ceil(b.body.length / limit))
      if (segments > 1) warnings.push(`SMS will send as ${segments} segments (${hasEmoji ? 'UCS-2' : 'GSM-7'} ${b.body.length}/${limit}).`)
    }
    return { ok: missing.length === 0, missing, warnings }
  }
)

// Short-link shortener (first-party, lives in messaging-service).
app.post<{ Body: { destination_url: string; kind?: string; variant_id?: string; expires_at?: string } }>(
  '/short-links',
  async req => {
    const code = randomBytes(6).toString('base64url').slice(0, 8)
    // Always the main DB: the public /s/:code redirect has no tenant context and reads it there.
    await db.query(
      `INSERT INTO short_link (code, tenant_id, variant_id, destination_url, kind, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [code, req.claims.tenantId, req.body.variant_id ?? null, req.body.destination_url, req.body.kind ?? 'page', req.body.expires_at ?? null]
    )
    return { code, url: `${process.env.SHORT_LINK_BASE || 'https://img.jeffistores.in'}/${code}` }
  }
)

app.get<{ Params: { code: string } }>('/s/:code', { config: { skipAuth: true } }, async (req, reply) => {
  // Public, no auth. onRequest hook skips /s/* via url prefix check — see below.
  const row = (await db.query<{ destination_url: string; tenant_id: string }>(
    `SELECT destination_url, tenant_id FROM short_link WHERE code=$1 AND (expires_at IS NULL OR expires_at > now())`,
    [req.params.code]
  )).rows[0]
  if (!row) return reply.code(404).send({ error: 'not_found' })
  // Fire-and-forget click increment.
  db.query(`UPDATE short_link SET click_count=click_count+1 WHERE code=$1`, [req.params.code]).catch(() => {})
  return reply.redirect(row.destination_url, 302)
})

// WhatsApp approval wiring (Twilio Content API).
const submitHandler = async (req: FastifyRequest<{ Body: { templateId: string; name?: string; category?: string } }>) => {
  const { pool } = await poolFor(req)
  return wa.submit(pool, req.claims.tenantId, req.claims.tenantSlug, req.body.templateId, { name: req.body.name, category: req.body.category, space: spaceOf(req) })
}
app.post('/wa/submit-approval', submitHandler)
app.post('/v2/templates/wa/submit-approval', submitHandler)

const syncHandler = async (req: FastifyRequest) => {
  const { pool } = await poolFor(req)
  return wa.syncTenant(pool, req.claims.tenantId)
}
app.post('/wa/sync-approval', syncHandler)
app.post('/v2/templates/wa/sync-approval', syncHandler)

// Bulk-copy the seed catalog into the caller's tenant. Idempotent per slug+channel.
app.post<{ Querystring: { force?: string } }>('/system-templates/install', async req => {
  if (!req.claims.internal) throw Object.assign(new Error('internal only'), { status: 403 })
  const { pool } = await poolFor(req)
  let created = 0, skipped = 0
  for (const seed of CATALOG) {
    const existing = await tpl.findBySlug(pool, req.claims.tenantId, seed.channel, seed.slug, seed.locale ?? 'en')
    if (existing && req.query.force !== '1') { skipped++; continue }
    const providerRef = seed.channel === 'whatsapp' ? WA_APPROVED_SIDS[seed.slug] : undefined
    const t = await tpl.upsertTemplate(pool, req.claims.tenantId, {
      ...seed,
      provider_ref: providerRef ?? seed.provider_ref,
      publish: true,
    })
    if (providerRef && t.variant) await tpl.setApprovalStatus(pool, t.variant.id, { status: 'approved', raw: 'approved' })
    created++
  }
  return { created, skipped, total: CATALOG.length }
})

// ── webhooks ──
// Twilio status callback (form-encoded). ?m=<message id> was set on send. Trues the wallet debit up
// to the exact provider price (USD → INR + margin) and records the delivery event.
app.post<{ Querystring: { m?: string }; Body: Record<string, string> }>('/webhooks/twilio/status', async (req, reply) => {
  const id = req.query.m
  const status = req.body?.MessageStatus
  if (!id || !status) return reply.code(400).send({ ok: false })
  const m = await one<MessageRow>(`SELECT * FROM messages WHERE id=$1`, [id])
  if (!m) return { ok: true }
  const terminal: Record<string, string> = { delivered: 'delivered', failed: 'failed', undelivered: 'failed', read: 'delivered' }
  const next = terminal[status]
  await db.query(`INSERT INTO message_events (message_id, event, payload) VALUES ($1,$2,$3)`, [id, status, req.body])
  if (next) await db.query(`UPDATE messages SET status=$2, error=COALESCE($3,error), updated_at=now() WHERE id=$1`, [id, next, req.body?.ErrorMessage ?? null])
  const usd = priceUsd(req.body?.Price)
  if (usd !== null) {
    const { withMargin } = await import('@jeffi/pricing')
    const exact = (m.metadata as any)?.internal ? usdToInr(usd) : withMargin(usdToInr(usd))
    await wallet.trueUp({ tenantId: m.tenant_id, amountInr: exact, externalRef: `pub:${id}`, note: `${m.channel} → ${m.to_address} (exact)` })
    await db.query(`UPDATE messages SET charged_inr=$2, updated_at=now() WHERE id=$1`, [id, exact])
  }
  return { ok: true }
})

if (!process.env.VITEST) {
  const port = Number(process.env.PORT || 3101)
  await app.listen({ port, host: '0.0.0.0' })
  wa.startApprovalSync(m => app.log.info(m))
  startWorker(db, 'messages', async (item, job) => {
    const o = job.options as { space?: 'store' | 'api'; tenantSlug?: string }
    try {
      const m = await sendMessage({ tenantId: job.tenant_id, tenantSlug: o.tenantSlug, apiKeyId: job.api_key_id ?? undefined, batchId: job.id, space: o.space },
        SendMessageRequest.parse(item.input))
      if (m.status !== 'sent') throw new BulkItemError(m.error ?? m.status)
      return { resultId: m.id, spentInr: Number(m.charged_inr), usage: 'messages' }
    } catch (e: any) {
      if (e instanceof SendError) throw new BulkItemError(e.message, { stop: e.code === 'insufficient_balance' })
      throw e
    }
  }, { concurrency: Number(process.env.MESSAGING_BULK_CONCURRENCY || 2), log: (m, e) => app.log.error({ err: e }, m) })
}
