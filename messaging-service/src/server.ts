import Fastify, { type FastifyRequest } from 'fastify'
import formbody from '@fastify/formbody'
import { randomUUID } from 'node:crypto'
import { ZodError } from 'zod'
import { SendMessageRequest, BatchMessageRequest, UpsertTemplateRequest, TemplateQuery, Channel } from '@jeffi/api-contracts'
import { verifyServiceToken, bearer, type ServiceClaims } from '@jeffi/service-auth'
import { usdToInr } from '@jeffi/pricing'
import * as wallet from '@jeffi/wallet'
import { db, one } from './db.js'
import { sendMessage, getMessage, toApi as msgToApi, SendError, type MessageRow } from './send.js'
import { listTemplates, upsertTemplate, archiveTemplate, toApi as tplToApi } from './templates.js'
import { priceUsd } from './providers/twilio.js'

const app = Fastify({ logger: { level: process.env.LOG_LEVEL || 'info' } })
await app.register(formbody)

declare module 'fastify' {
  interface FastifyRequest {
    claims: ServiceClaims
  }
}

// Every non-webhook route needs a gateway-issued service token.
app.addHook('onRequest', async (req, reply) => {
  if (req.url.startsWith('/webhooks') || req.url === '/healthz') return
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
  return msgToApi(await sendMessage({ tenantId, tenantSlug, apiKeyId, internal }, body))
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
      const m = await sendMessage({ tenantId, tenantSlug, apiKeyId, batchId }, {
        channel: body.channel,
        to: r.to,
        template: body.template,
        subject: body.subject,
        variables: { ...(body.variables ?? {}), ...(r.variables ?? {}) },
        reference: r.reference,
      })
      if (m.status === 'sent') accepted++
      else rejected.push({ to: r.to, reason: m.error ?? m.status })
    } catch (e: any) {
      rejected.push({ to: r.to, reason: e instanceof SendError ? e.code : 'error' })
      if (e instanceof SendError && e.code === 'insufficient_balance') break
    }
  }
  return { batch_id: batchId, accepted, rejected }
})

app.get<{ Params: { id: string } }>('/messages/:id', async (req, reply) => {
  const m = await getMessage(req.claims.tenantId, req.params.id)
  if (!m) return reply.code(404).send({ error: 'not_found', message: 'Message not found' })
  return msgToApi(m)
})

app.get<{ Querystring: { limit?: string; cursor?: string; channel?: string } }>('/messages', async req => {
  const limit = Math.min(Number(req.query.limit ?? 50), 200)
  const rows = await db.query<MessageRow>(
    `SELECT * FROM messages WHERE tenant_id=$1 AND ($2::text IS NULL OR channel=$2) AND ($3::timestamptz IS NULL OR created_at < $3)
     ORDER BY created_at DESC LIMIT $4`,
    [req.claims.tenantId, req.query.channel ?? null, req.query.cursor ?? null, limit]
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

const port = Number(process.env.PORT || 3101)
await app.listen({ port, host: '0.0.0.0' })
