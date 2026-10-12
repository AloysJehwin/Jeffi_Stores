import { OpenApiGeneratorV31, OpenAPIRegistry, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'
import * as C from '@jeffi/api-contracts'

extendZodWithOpenApi(z)

const r = new OpenAPIRegistry()
r.registerComponent('securitySchemes', 'ApiKey', { type: 'http', scheme: 'bearer', description: 'Your API key: `Authorization: Bearer jk_live_…`' })
const sec = [{ ApiKey: [] }]
const err = (status: number, description: string) => ({ [status]: { description, content: { 'application/json': { schema: C.ErrorResponse } } } })

r.registerPath({
  method: 'post', path: '/v1/messages', tags: ['Messages'], security: sec,
  summary: 'Send one message', description: 'Send an email, SMS or WhatsApp message using a template slug or a raw body. Debits your wallet at the published price.',
  request: { body: { content: { 'application/json': { schema: C.SendMessageRequest } } } },
  responses: { 200: { description: 'Message accepted and handed to the provider', content: { 'application/json': { schema: C.Message } } }, ...err(402, 'Insufficient wallet balance'), ...err(422, 'Template variables missing') },
})
r.registerPath({
  method: 'post', path: '/v1/messages/batch', tags: ['Messages'], security: sec, summary: 'Send a campaign batch (≤ 500 recipients)',
  request: { body: { content: { 'application/json': { schema: C.BatchMessageRequest } } } },
  responses: { 200: { description: 'Per-recipient outcome', content: { 'application/json': { schema: C.BatchMessageResponse } } } },
})
r.registerPath({
  method: 'get', path: '/v1/messages/{id}', tags: ['Messages'], security: sec, summary: 'Get a message and its delivery status',
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: { description: 'Message', content: { 'application/json': { schema: C.Message } } }, ...err(404, 'Not found') },
})
r.registerPath({
  method: 'get', path: '/v1/messages', tags: ['Messages'], security: sec, summary: 'List recent messages',
  request: { query: z.object({ channel: C.Channel.optional(), limit: z.number().max(200).optional(), cursor: z.string().optional() }) },
  responses: { 200: { description: 'Page', content: { 'application/json': { schema: z.object({ items: z.array(C.Message), next_cursor: z.string().nullable() }) } } } },
})
r.registerPath({
  method: 'get', path: '/v1/templates', tags: ['Templates'], security: sec, summary: 'List templates (yours + system/*)',
  request: { query: C.TemplateQuery },
  responses: { 200: { description: 'Templates', content: { 'application/json': { schema: z.object({ items: z.array(C.Template) }) } } } },
})
r.registerPath({
  method: 'post', path: '/v1/templates', tags: ['Templates'], security: sec, summary: 'Create or update a template', description: 'Upsert on (channel, slug). Use `{{variable}}` tokens; the service reports the variables it finds.',
  request: { body: { content: { 'application/json': { schema: C.UpsertTemplateRequest } } } },
  responses: { 200: { description: 'Template', content: { 'application/json': { schema: C.Template } } } },
})
r.registerPath({
  method: 'delete', path: '/v1/templates/{channel}/{slug}', tags: ['Templates'], security: sec, summary: 'Archive a template',
  request: { params: z.object({ channel: C.Channel, slug: z.string() }) },
  responses: { 200: { description: 'Archived' }, ...err(404, 'Not found') },
})
r.registerPath({
  method: 'post', path: '/v1/documents/{type}', tags: ['Documents'], security: sec, summary: 'Render a PDF document', description: 'GST is computed server-side. Returns a signed PDF URL (1 h) and a shareable viewer URL.',
  request: { params: z.object({ type: C.DocumentType }), body: { content: { 'application/json': { schema: C.RenderDocumentRequest } } } },
  responses: { 200: { description: 'Document', content: { 'application/json': { schema: C.Document } } }, ...err(402, 'Insufficient wallet balance') },
})
r.registerPath({
  method: 'get', path: '/v1/documents/{id}', tags: ['Documents'], security: sec, summary: 'Get a document (fresh signed URL)',
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: { description: 'Document', content: { 'application/json': { schema: C.Document } } }, ...err(404, 'Not found') },
})
r.registerPath({
  method: 'get', path: '/v1/wallet', tags: ['Account'], security: sec, summary: 'Wallet balance and today’s spend',
  responses: { 200: { description: 'Wallet', content: { 'application/json': { schema: C.Wallet } } } },
})
r.registerPath({
  method: 'get', path: '/v1/pricing', tags: ['Account'], summary: 'Current public prices (INR, margin included)',
  responses: { 200: { description: 'Prices' } },
})

export function buildOpenApi() {
  return new OpenApiGeneratorV31(r.definitions).generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Jeffi Public API',
      version: '1.0.0',
      description: [
        'Messaging (email · SMS · WhatsApp) and document rendering (invoices, quotations, receipts, labels) for any application.',
        '',
        '**Auth** — every call carries `Authorization: Bearer <api key>`. Create keys in your dashboard at ecom.jeffistores.in → API keys.',
        '**Billing** — prepaid wallet. Each message/document debits the price from `/v1/pricing`; SMS/WhatsApp are trued-up to the exact carrier price after delivery. A `402` means top up.',
        '**Idempotency** — send `Idempotency-Key: <uuid>` on POSTs to make retries safe for 24 h.',
        '**Rate limits** — per key, default 120 req/min; see `X-RateLimit-*` headers.',
      ].join('\n'),
    },
    servers: [{ url: 'https://public.jeffistores.in' }],
  })
}
