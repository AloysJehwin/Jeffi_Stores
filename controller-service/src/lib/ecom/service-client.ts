import { createHmac } from 'node:crypto'

// Dashboard → messaging/document service calls. Mirrors packages/service-auth (kept local so the
// Next app does not depend on the workspace package yet).
const MESSAGING_URL = (process.env.MESSAGING_URL || 'http://localhost:3101').replace(/\/$/, '')
const DOCUMENTS_URL = (process.env.DOCUMENTS_URL || 'http://localhost:3102').replace(/\/$/, '')

function token(tenantId: string, tenantSlug: string, internal = false, space: 'store' | 'api' = 'store') {
  const secret = process.env.SERVICE_AUTH_SECRET
  if (!secret) throw new Error('SERVICE_AUTH_SECRET is not set')
  const payload = JSON.stringify({ service: 'platform', tenantId, tenantSlug, internal, space, exp: Math.floor(Date.now() / 1000) + 60 })
  const sig = createHmac('sha256', secret).update(payload).digest()
  return `${Buffer.from(payload).toString('base64url')}.${sig.toString('base64url')}`
}

type Init = { method?: string; body?: unknown; internal?: boolean; space?: 'store' | 'api' }

export function fetchService(service: 'messaging' | 'documents', tenant: { id: string; slug: string }, path: string, init: Init = {}) {
  const base = service === 'messaging' ? MESSAGING_URL : DOCUMENTS_URL
  return fetch(base + path, {
    method: init.method ?? 'GET',
    headers: { authorization: `Bearer ${token(tenant.id, tenant.slug, init.internal, init.space)}`, 'content-type': 'application/json' },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  })
}

export async function callService(
  service: 'messaging' | 'documents',
  tenant: { id: string; slug: string },
  path: string,
  // space 'api' = the Messaging-API product's own template copies (the console); 'store' = the store's.
  init: Init = {}
): Promise<{ status: number; body: unknown }> {
  const res = await fetchService(service, tenant, path, init)
  const text = await res.text()
  try {
    return { status: res.status, body: JSON.parse(text) }
  } catch {
    return { status: res.status, body: text }
  }
}
