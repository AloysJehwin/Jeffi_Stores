import { createHmac } from 'node:crypto'

// Dashboard → messaging/document service calls. Mirrors packages/service-auth (kept local so the
// Next app does not depend on the workspace package yet).
const MESSAGING_URL = (process.env.MESSAGING_URL || 'http://localhost:3101').replace(/\/$/, '')
const DOCUMENTS_URL = (process.env.DOCUMENTS_URL || 'http://localhost:3102').replace(/\/$/, '')

function token(tenantId: string, tenantSlug: string) {
  const secret = process.env.SERVICE_AUTH_SECRET
  if (!secret) throw new Error('SERVICE_AUTH_SECRET is not set')
  const payload = JSON.stringify({ service: 'platform', tenantId, tenantSlug, exp: Math.floor(Date.now() / 1000) + 60 })
  const sig = createHmac('sha256', secret).update(payload).digest()
  return `${Buffer.from(payload).toString('base64url')}.${sig.toString('base64url')}`
}

export async function callService(
  service: 'messaging' | 'documents',
  tenant: { id: string; slug: string },
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<{ status: number; body: unknown }> {
  const base = service === 'messaging' ? MESSAGING_URL : DOCUMENTS_URL
  const res = await fetch(base + path, {
    method: init.method ?? 'GET',
    headers: { authorization: `Bearer ${token(tenant.id, tenant.slug)}`, 'content-type': 'application/json' },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  })
  const text = await res.text()
  try {
    return { status: res.status, body: JSON.parse(text) }
  } catch {
    return { status: res.status, body: text }
  }
}
