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
  summary: 'Send one message', description: 'Send an email, SMS or WhatsApp message using a template slug or a raw body. Debits your wallet at the published price. WhatsApp templates with an image header or link button: pass `media_url` / `button_url` and the service fills those slots.',
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
const T = { 'application/json': { schema: C.LibraryTemplate } }
const slugParams = z.object({ channel: C.Channel, slug: z.string().describe('URL-encoded slug, e.g. cart%2Fabandoned') })
r.registerPath({
  method: 'get', path: '/v1/templates', tags: ['Templates'], security: sec, summary: 'List templates',
  description: 'Your templates plus the standard ones (`source: platform`). The same library as the dashboard → Messaging → Templates.',
  request: { query: z.object({ channel: C.Channel.optional() }) },
  responses: { 200: { description: 'Templates', content: { 'application/json': { schema: z.object({ items: z.array(C.LibraryTemplate) }) } } } },
})
r.registerPath({
  method: 'get', path: '/v1/templates/{channel}/{slug}', tags: ['Templates'], security: sec, summary: 'Get a template (your copy, else the standard one)',
  request: { params: slugParams },
  responses: { 200: { description: 'Template with its current version', content: T }, ...err(404, 'Not found') },
})
r.registerPath({
  method: 'post', path: '/v1/templates', tags: ['Templates'], security: sec, summary: 'Create or update a template',
  description: 'Upsert on (channel, slug); every save is a new version. Variables: `{{name}}` for email/SMS, `{{1}}…{{n}}` for WhatsApp (give samples in `blocks.variables`). WhatsApp extras: `blocks.buttons` (≤3), `blocks.carousel.cards` (≤10), header media in `blocks.types["twilio/media"].media`. Saving a standard slug creates your own copy.',
  request: { body: { content: { 'application/json': { schema: C.UpsertLibraryTemplateRequest } } } },
  responses: { 200: { description: 'Template', content: T }, ...err(400, 'Invalid template') },
})
r.registerPath({
  method: 'put', path: '/v1/templates/{id}', tags: ['Templates'], security: sec, summary: 'Update a template by id (new version)',
  request: { params: z.object({ id: z.string().uuid() }), body: { content: { 'application/json': { schema: C.UpdateLibraryTemplateRequest } } } },
  responses: { 200: { description: 'Template', content: T }, ...err(404, 'Not found') },
})
r.registerPath({
  method: 'get', path: '/v1/templates/{id}/versions', tags: ['Templates'], security: sec, summary: 'Version history',
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: { description: 'Versions, newest first' } },
})
r.registerPath({
  method: 'post', path: '/v1/templates/{id}/publish', tags: ['Templates'], security: sec, summary: 'Make an older version current',
  request: { params: z.object({ id: z.string().uuid() }), body: { content: { 'application/json': { schema: z.object({ versionId: z.string().uuid() }) } } } },
  responses: { 200: { description: 'Published' }, ...err(404, 'Version not found') },
})
r.registerPath({
  method: 'post', path: '/v1/templates/preview', tags: ['Templates'], security: sec, summary: 'Render a template with variables (missing ones get samples)',
  request: { body: { content: { 'application/json': { schema: C.TemplatePreviewRequest } } } },
  responses: { 200: { description: 'Rendered subject/body + which variables were sampled' } },
})
r.registerPath({
  method: 'post', path: '/v1/templates/validate', tags: ['Templates'], security: sec, summary: 'Check a draft body (missing variables, SMS segments)',
  request: { body: { content: { 'application/json': { schema: z.object({ channel: C.Channel, subject: z.string().optional(), body: z.string(), variables: z.record(z.string(), z.unknown()).optional() }) } } } },
  responses: { 200: { description: '{ ok, missing, warnings }' } },
})
r.registerPath({
  method: 'post', path: '/v1/templates/{id}/submit-approval', tags: ['Templates'], security: sec, summary: 'Submit a WhatsApp template to Meta',
  description: 'Meta must approve a WhatsApp template before it can be sent to customers who have not messaged you first. Rules are checked before submitting (422 lists problems).',
  request: { params: z.object({ id: z.string().uuid() }), body: { content: { 'application/json': { schema: z.object({ category: z.enum(['MARKETING', 'UTILITY']).optional() }) } } } },
  responses: { 200: { description: 'Submitted (approval_status pending)' }, ...err(422, 'Fails Meta rules'), ...err(409, 'Already submitted') },
})
r.registerPath({
  method: 'post', path: '/v1/templates/sync-approval', tags: ['Templates'], security: sec, summary: 'Refresh WhatsApp approval statuses now (also runs every 10 minutes)',
  responses: { 200: { description: '{ checked, changed }' } },
})
r.registerPath({
  method: 'delete', path: '/v1/templates/{channel}/{slug}', tags: ['Templates'], security: sec, summary: 'Archive your template',
  description: 'Archives your copy; the standard template (if any) takes over again. Standard templates cannot be deleted.',
  request: { params: slugParams },
  responses: { 200: { description: 'Archived' }, ...err(404, 'Not found') },
})
r.registerPath({
  method: 'post', path: '/v1/documents/{type}', tags: ['Documents'], security: sec, summary: 'Render a PDF document', description: 'GST is computed server-side. Returns a signed PDF URL (1 h) and a shareable viewer URL.\n\n**Design** — `template` picks one of the 10 designs (`aurora`, `ledger`, `minimal`, `block`, `editorial`, `grid`, `mono`, `corporate`, `boutique`, `compact`; see `GET /v1/documents/designs`). Omit it to use the design chosen in your dashboard (Documents → Designs), else `aurora`. Older keys still work: `classic`, `bold`, `gst-detailed`, `thermal-80mm` (80 mm roll for receipts and labels).\n\n**Branding** — `branding.accent` (#rrggbb), `branding.font` (`modern` · `geometric` · `classic` · `editorial` · `technical` · `system`) and `branding.logo_url` (public https image) override your dashboard settings for this call.',
  request: { params: z.object({ type: C.DocumentType }), body: { content: { 'application/json': { schema: C.RenderDocumentRequest } } } },
  responses: { 200: { description: 'Document', content: { 'application/json': { schema: C.Document } } }, ...err(402, 'Insufficient wallet balance') },
})
r.registerPath({
  method: 'get', path: '/v1/documents/{id}', tags: ['Documents'], security: sec, summary: 'Get a document (fresh signed URL)',
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: { description: 'Document', content: { 'application/json': { schema: C.Document } } }, ...err(404, 'Not found') },
})
r.registerPath({
  method: 'get', path: '/v1/documents', tags: ['Documents'], security: sec, summary: 'List documents (newest first)',
  request: { query: z.object({ type: C.DocumentType.optional(), limit: z.coerce.number().int().min(1).max(200).optional(), cursor: z.string().optional().openapi({ description: '`next_cursor` from the previous page' }) }) },
  responses: { 200: { description: 'Page of documents', content: { 'application/json': { schema: z.object({ items: z.array(C.Document), next_cursor: z.string().nullable() }) } } } },
})
r.registerPath({
  method: 'get', path: '/v1/documents/designs', tags: ['Documents'], security: sec, summary: 'List the document designs and font pairings',
  responses: { 200: { description: 'Designs', content: { 'application/json': { schema: z.object({ designs: z.array(C.DocumentDesign), fonts: z.array(z.object({ key: C.DocumentFont, label: z.string() })), default: z.string() }) } } } },
})
r.registerPath({
  method: 'get', path: '/v1/documents/designs/{key}/preview/{type}', tags: ['Documents'], security: sec, summary: 'Preview a design with sample data (PDF, free)',
  description: 'Uses your saved logo and branding; `accent` / `font` query parameters try alternatives.',
  request: { params: z.object({ key: z.string(), type: C.DocumentType }), query: z.object({ accent: z.string().optional().openapi({ example: '#4f46e5' }), font: C.DocumentFont.optional() }) },
  responses: { 200: { description: 'PDF', content: { 'application/pdf': { schema: z.string().openapi({ format: 'binary' }) } } }, ...err(404, 'Unknown design') },
})
r.registerPath({
  method: 'get', path: '/v1/documents/{id}/pdf', tags: ['Documents'], security: sec, summary: 'Download a document PDF',
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: { description: 'PDF', content: { 'application/pdf': { schema: z.string().openapi({ format: 'binary' }) } } }, ...err(404, 'Not found') },
})
r.registerPath({
  method: 'get', path: '/v1/wallet', tags: ['Account'], security: sec, summary: 'Wallet balance and today’s spend',
  responses: { 200: { description: 'Wallet', content: { 'application/json': { schema: C.Wallet } } } },
})
r.registerPath({
  method: 'get', path: '/v1/pricing', tags: ['Account'], summary: 'Current public prices (INR, margin included)',
  responses: { 200: { description: 'Prices' } },
})

// ── bulk ──
const Job = { 'application/json': { schema: C.BulkJob } }
const jobId = z.object({ id: z.string().uuid() })
const itemsQuery = z.object({ status: z.enum(['pending', 'running', 'done', 'failed', 'skipped']).optional(), cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).optional() })
const BULK_HOW = 'Async: returns **202** with a job right away; a worker processes the items. Poll `GET …/bulk/{id}` until `status` is `completed`, `partial`, `failed` or `cancelled`, then page through `…/items`. Each item is charged like a single call. If the wallet runs out the job stops as `partial` (remaining items `skipped`); top up and `POST …/retry`. Send an `Idempotency-Key` so a retried POST does not create a second job.'
r.registerPath({
  method: 'post', path: '/v1/documents/bulk', tags: ['Documents'], security: sec, summary: 'Bulk: render up to 1000 documents',
  description: BULK_HOW + ' Documents are numbered in item order. When done, `zip_url` downloads every PDF as one ZIP.',
  request: { body: { content: { 'application/json': { schema: C.BulkDocumentsRequest } } } },
  responses: { 202: { description: 'Job created', content: Job }, ...err(400, 'Invalid items (details list each index)') },
})
r.registerPath({
  method: 'post', path: '/v1/messages/bulk', tags: ['Messages'], security: sec, summary: 'Bulk: send a template to up to 10 000 recipients',
  description: BULK_HOW + ' Per-recipient `variables` are merged over the job-level ones. Each message carries `batch_id` = the job id (`GET /v1/messages?batch_id=…`).',
  request: { body: { content: { 'application/json': { schema: C.BulkMessagesRequest } } } },
  responses: { 202: { description: 'Job created', content: Job }, ...err(404, 'Template not found') },
})
for (const kind of ['documents', 'messages'] as const) {
  const base = `/v1/${kind}/bulk`
  const tags = [kind === 'documents' ? 'Documents' : 'Messages']
  r.registerPath({ method: 'get', path: base, tags, security: sec, summary: 'Bulk: list jobs',
    request: { query: z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).optional() }) },
    responses: { 200: { description: 'Jobs', content: { 'application/json': { schema: z.object({ items: z.array(C.BulkJob), next_cursor: z.string().nullable() }) } } } } })
  r.registerPath({ method: 'get', path: `${base}/{id}`, tags, security: sec, summary: 'Bulk: get a job (progress)',
    request: { params: jobId }, responses: { 200: { description: 'Job', content: Job }, ...err(404, 'Not found') } })
  r.registerPath({ method: 'get', path: `${base}/{id}/items`, tags, security: sec, summary: 'Bulk: per-item results',
    description: kind === 'documents' ? '`result` is the document (number, pdf_url, view_url …).' : '`result` is the message (status, charged_inr …).',
    request: { params: jobId, query: itemsQuery },
    responses: { 200: { description: 'Items', content: { 'application/json': { schema: z.object({ items: z.array(C.BulkItem), next_cursor: z.string().nullable() }) } } } } })
  r.registerPath({ method: 'post', path: `${base}/{id}/cancel`, tags, security: sec, summary: 'Bulk: cancel (pending items are skipped)',
    request: { params: jobId }, responses: { 200: { description: 'Job', content: Job } } })
  r.registerPath({ method: 'post', path: `${base}/{id}/retry`, tags, security: sec, summary: 'Bulk: re-run failed and skipped items',
    request: { params: jobId }, responses: { 200: { description: 'Job', content: Job } } })
}
r.registerPath({
  method: 'get', path: '/v1/documents/bulk/{id}/zip', tags: ['Documents'], security: sec, summary: 'Bulk: download all PDFs as a ZIP',
  request: { params: jobId },
  responses: { 200: { description: 'ZIP', content: { 'application/zip': { schema: z.string().openapi({ format: 'binary' }) } } }, ...err(404, 'No documents yet') },
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
