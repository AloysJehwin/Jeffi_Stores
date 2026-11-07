import { createHash, timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'
import { PLATFORM_TENANT_ID } from '@/lib/import/jobs'
import { resolveTenantFromHost, slugFromHost } from '@/lib/tenant-registry'
import { runWithTenantContext, type TenantContext } from '@/lib/tenancy/tenant-context'
import { resolveMarketplaceCreds, type MarketplaceCreds } from '@/lib/integrations/resolve'
import { AdapterUnavailableError, eventKey, type PushEvent } from './adapter'
import { resolveEndpoints } from './endpoints'
import { processEvents, recordEvents } from './ingest'
import { getAdapter } from './registry'
import type { MarketplaceChannel } from './types'

// Inbound order pushes on the store's own host (https://{slug}.jeffistores.in/api/webhooks/myntra or a
// custom domain). The store comes from the Host. The push token we gave the marketplace is checked
// in constant time (the previous token still works for 24 h after a rotate), then the optional IP
// allowlist. Events are stored before anything else: a failed write is a 503 so the marketplace
// retries; once stored the answer is always 200 (duplicates too) and processing runs inline for
// about 5 s, leaving the rest to the sync cron.

export const MAX_PUSH_BYTES = 1024 * 1024
export const PUSH_PROCESS_BUDGET_MS = 5000
const PREV_TOKEN_TTL_MS = 24 * 3600_000

const json = (body: object, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest()
const same = (a: string, b: string) => timingSafeEqual(digest(a), digest(b))

/** The presented token matches the current one, or the previous one within 24 h of the rotate. */
export function pushTokenValid(presented: string | null, creds: Pick<MarketplaceCreds, 'push_token' | 'push_token_prev' | 'push_token_rotated_at'>, now = Date.now()): boolean {
  if (!presented || !creds.push_token) return false
  const current = same(presented, creds.push_token)
  const rotatedAt = creds.push_token_rotated_at ? Date.parse(creds.push_token_rotated_at) : NaN
  const prevLive = !!creds.push_token_prev && Number.isFinite(rotatedAt) && now - rotatedAt <= PREV_TOKEN_TTL_MS
  const previous = prevLive ? same(presented, creds.push_token_prev!) : false
  return current || previous
}

function ipv4ToInt(ip: string): number | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return null
  const parts = m.slice(1).map(Number)
  if (parts.some(p => p > 255)) return null
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
}

/** Exact IPs, or IPv4 CIDR ranges. */
export function ipAllowed(ip: string, allowlist: string[]): boolean {
  const addr = ip.startsWith('::ffff:') ? ip.slice(7) : ip
  for (const entry of allowlist) {
    const e = entry.trim()
    if (!e) continue
    if (!e.includes('/')) {
      if (e === addr) return true
      continue
    }
    const [base, bitsRaw] = e.split('/')
    const bits = Number(bitsRaw)
    const a = ipv4ToInt(addr)
    const b = ipv4ToInt(base)
    if (a == null || b == null || !Number.isInteger(bits) || bits < 0 || bits > 32) continue
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
    if ((a & mask) === (b & mask)) return true
  }
  return false
}

const clientIp = (h: Headers) => h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || ''

/** The body as text, or null when it is over the limit (checked while streaming). */
async function readCapped(request: Request, max: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? 0)
  if (declared > max) return null
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** One stored event for a body the adapter can't split yet (its API docs haven't arrived). */
function rawEvent(channel: MarketplaceChannel, raw: string, body: unknown): PushEvent {
  return { key: eventKey(channel, 'raw', raw), type: 'raw', externalOrderId: null, occurredAt: null, payload: body }
}

async function handleForStore(channel: MarketplaceChannel, request: Request, raw: string, tenantId: string): Promise<Response> {
  let creds: MarketplaceCreds | null
  try {
    creds = await resolveMarketplaceCreds(channel, tenantId)
  } catch {
    return json({ error: 'retry' }, 503)
  }
  if (!creds?.push_token) return json({ error: 'Not connected' }, 404)

  const header = resolveEndpoints(channel, creds).headers.pushToken
  if (!pushTokenValid(request.headers.get(header), creds)) return json({ error: 'Invalid token' }, 401)
  if (creds.ip_allowlist?.length && !ipAllowed(clientIp(request.headers), creds.ip_allowlist)) return json({ error: 'Forbidden' }, 403)

  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  let events: PushEvent[]
  try {
    events = getAdapter(channel, creds).parsePush(body, request.headers)
  } catch (e) {
    if (!(e instanceof AdapterUnavailableError)) return json({ error: 'Invalid payload' }, 400)
    events = [rawEvent(channel, raw, body)]
  }
  if (!events.length) return json({ ok: true, received: 0 })

  let stored: { ids: string[]; duplicates: number }
  try {
    stored = await recordEvents(channel, events, 'push')
  } catch (err) {
    console.error(`[webhook:${channel}] could not record events`, err)
    return json({ error: 'retry' }, 503)
  }
  let processed = 0
  try {
    processed = (await processEvents(stored.ids, PUSH_PROCESS_BUDGET_MS)).processed
  } catch (err) {
    console.error(`[webhook:${channel}] inline processing failed`, err)
  }
  return json({ ok: true, received: events.length, duplicates: stored.duplicates, processed })
}

export async function handleMarketplacePush(channel: MarketplaceChannel, request: Request): Promise<Response> {
  const raw = await readCapped(request, MAX_PUSH_BYTES)
  if (raw == null) return json({ error: 'Payload too large' }, 413)

  const host = request.headers.get('host') || new URL(request.url).host
  let tenant: TenantContext | null
  try {
    tenant = await resolveTenantFromHost(host)
  } catch {
    return json({ error: 'retry' }, 503)
  }
  if (!tenant) {
    // A tenant-shaped host that resolves to nothing must not fall through to the flagship.
    const parsed = slugFromHost(host)
    if (parsed.slug || parsed.isCustomDomain) return json({ error: 'Unknown store' }, 404)
    return handleForStore(channel, request, raw, PLATFORM_TENANT_ID)
  }
  const store = tenant
  return runWithTenantContext(store, () => handleForStore(channel, request, raw, store.tenantId))
}
