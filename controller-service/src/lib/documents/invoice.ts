import { createHmac } from 'node:crypto'
import { resolveTenant } from '@/lib/tenancy/tenant-context'
import { FLAGSHIP_TENANT_ID } from '@/lib/payments/wallet'

// Invoice numbering + PDF rendering live in document-service; these are the monolith's
// system-level entry points (checkout, webhooks, subscription cycles). No admin session.
const DOCUMENTS_URL = (process.env.DOCUMENTS_URL || 'http://localhost:3102').replace(/\/$/, '')

async function call(path: string): Promise<Response> {
  const t = (await resolveTenant()) ?? { tenantId: FLAGSHIP_TENANT_ID, slug: 'platform' }
  const secret = process.env.SERVICE_AUTH_SECRET
  if (!secret) throw new Error('SERVICE_AUTH_SECRET is not set')
  const payload = JSON.stringify({ service: 'platform', internal: true, tenantId: t.tenantId, tenantSlug: t.slug, exp: Math.floor(Date.now() / 1000) + 60 })
  const sig = createHmac('sha256', secret).update(payload).digest()
  const res = await fetch(DOCUMENTS_URL + path, {
    method: 'POST',
    headers: { authorization: `Bearer ${Buffer.from(payload).toString('base64url')}.${sig.toString('base64url')}` },
    cache: 'no-store',
  })
  if (!res.ok && res.status !== 204) throw new Error(`document-service ${path} → ${res.status}`)
  return res
}

export async function createDraftInvoice(orderId: string): Promise<void> {
  await call(`/orders/${orderId}/invoice/draft`)
}

/** Idempotent. `client` is accepted for call-site compatibility; the service runs its own transaction. */
export async function assignInvoiceNumber(_client: unknown, orderId: string): Promise<string | null> {
  const d = (await (await call(`/orders/${orderId}/invoice/number`)).json()) as { invoice_number: string | null }
  return d.invoice_number
}

export async function generateOrderInvoice(orderId: string): Promise<Buffer | null> {
  const res = await call(`/orders/${orderId}/invoice/generate`)
  if (res.status === 204) return null
  return Buffer.from(await res.arrayBuffer())
}
