import { z } from 'zod'
import type { MarketplaceChannel, MarketplaceMode } from './types'

// Per-channel API addresses, header names, batch sizes and rate limits. The defaults are
// placeholders until the partner docs arrive; corrections are config, not code:
// MARKETPLACE_ENDPOINTS_JSON overrides them platform-wide ({"myntra": {"baseUrl": ...}}), and a
// store's creds.endpoints overrides baseUrl, pushTokenHeader or any path (sandbox URLs).

export const ENDPOINT_PATHS = [
  'token',
  'inventory',
  'orderAction',
  'ack',
  'label',
  'invoice',
  'manifest',
  'manifestDocument',
  'invoiceUpload',
  'listings',
  'listingTask',
  'returns',
  'settlements',
] as const
export type EndpointPath = (typeof ENDPOINT_PATHS)[number]

export interface ChannelEndpoints {
  baseUrl: string
  sandboxBaseUrl: string
  /** {orderId}, {packetId}, {taskId} etc. are filled by endpointUrl. */
  paths: Record<EndpointPath, string>
  headers: { pushToken: string; auth: string; authScheme: string }
  batch: { inventory: number; listings: number; manifest: number }
  rateLimit: { perSecond: number }
  tokenTtlSecs: number
}

const DEFAULTS: Record<MarketplaceChannel, ChannelEndpoints> = {
  myntra: {
    baseUrl: 'https://partner-api.myntra.com',
    sandboxBaseUrl: 'https://sandbox-partner-api.myntra.com',
    paths: {
      token: '/v4/auth/token',
      inventory: '/v4/inventory/update',
      orderAction: '/v4/orders/{orderId}/lines/events',
      ack: '/v4/orders/ack',
      label: '/v4/orders/{orderId}/label',
      invoice: '/v4/orders/{orderId}/invoice',
      manifest: '/v4/manifests',
      manifestDocument: '/v4/manifests/{manifestId}',
      invoiceUpload: '/v4/orders/{orderId}/invoice/upload',
      listings: '/v4/listings/submit',
      listingTask: '/v4/listings/tasks/{taskId}',
      returns: '/v4/returns/{returnId}/events',
      settlements: '/v4/settlements',
    },
    headers: { pushToken: 'x-push-token', auth: 'Authorization', authScheme: 'Bearer' },
    batch: { inventory: 50, listings: 19, manifest: 100 },
    rateLimit: { perSecond: 5 },
    tokenTtlSecs: 3600,
  },
  ajio: {
    baseUrl: 'https://vms-api.ajio.com',
    sandboxBaseUrl: 'https://vms-api-uat.ajio.com',
    paths: {
      token: '/api/v1/auth/login',
      inventory: '/api/v1/inventory',
      orderAction: '/api/v1/orders/{orderId}/action',
      ack: '/api/v1/orders/ack',
      label: '/api/v1/orders/{orderId}/label',
      invoice: '/api/v1/orders/{orderId}/invoice',
      manifest: '/api/v1/manifests',
      manifestDocument: '/api/v1/manifests/{manifestId}',
      invoiceUpload: '/api/v1/orders/{orderId}/b2b-invoice',
      listings: '/api/v1/listings',
      listingTask: '/api/v1/listings/tasks/{taskId}',
      returns: '/api/v1/returns/{returnId}/action',
      settlements: '/api/v1/settlements',
    },
    headers: { pushToken: 'x-push-token', auth: 'Authorization', authScheme: 'Bearer' },
    batch: { inventory: 100, listings: 50, manifest: 250 },
    rateLimit: { perSecond: 5 },
    tokenTtlSecs: 3600,
  },
}

const url = z.string().url().refine(u => u.startsWith('https://'), 'must be https')
const pathsSchema = z.object(Object.fromEntries(ENDPOINT_PATHS.map(p => [p, z.string().startsWith('/').optional()])) as Record<EndpointPath, z.ZodOptional<z.ZodString>>)
const channelOverride = z.object({
  baseUrl: url.optional(),
  sandboxBaseUrl: url.optional(),
  paths: pathsSchema.optional(),
  headers: z.object({ pushToken: z.string().min(1), auth: z.string().min(1), authScheme: z.string() }).partial().optional(),
  batch: z.object({ inventory: z.number().int().positive(), listings: z.number().int().positive(), manifest: z.number().int().positive() }).partial().optional(),
  rateLimit: z.object({ perSecond: z.number().positive() }).partial().optional(),
  tokenTtlSecs: z.number().int().positive().optional(),
})
export const endpointsOverrideSchema = z.object({ myntra: channelOverride.optional(), ajio: channelOverride.optional() })
export type EndpointsOverride = z.infer<typeof endpointsOverrideSchema>

let cached: { raw: string | undefined; value: EndpointsOverride } | null = null

/** The platform override from MARKETPLACE_ENDPOINTS_JSON; an invalid value is logged and ignored. */
export function platformOverride(raw = process.env.MARKETPLACE_ENDPOINTS_JSON): EndpointsOverride {
  if (cached && cached.raw === raw) return cached.value
  let value: EndpointsOverride = {}
  if (raw?.trim()) {
    try {
      const parsed = endpointsOverrideSchema.safeParse(JSON.parse(raw))
      if (parsed.success) value = parsed.data
      else console.error('[marketplace] MARKETPLACE_ENDPOINTS_JSON ignored:', parsed.error.issues[0]?.message)
    } catch {
      console.error('[marketplace] MARKETPLACE_ENDPOINTS_JSON is not valid JSON; ignored')
    }
  }
  cached = { raw, value }
  return value
}

/** A store may only point at a public https host. */
export function safeStoreUrl(u: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(u)
  } catch {
    return false
  }
  const host = parsed.hostname.toLowerCase()
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return false
  if (parsed.port && parsed.port !== '443') return false
  if (!host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') || host.startsWith('[')) return false
  return !['localhost', '.localhost', '.local', '.internal', '.cluster.local', '.svc'].some(s => host === s || host.endsWith(s))
}

function merge(base: ChannelEndpoints, o?: z.infer<typeof channelOverride>): ChannelEndpoints {
  if (!o) return base
  const paths = { ...base.paths }
  for (const p of ENDPOINT_PATHS) if (o.paths?.[p]) paths[p] = o.paths[p]!
  return {
    baseUrl: o.baseUrl ?? base.baseUrl,
    sandboxBaseUrl: o.sandboxBaseUrl ?? base.sandboxBaseUrl,
    paths,
    headers: { ...base.headers, ...o.headers },
    batch: { ...base.batch, ...o.batch },
    rateLimit: { ...base.rateLimit, ...o.rateLimit },
    tokenTtlSecs: o.tokenTtlSecs ?? base.tokenTtlSecs,
  }
}

export interface ResolvedEndpoints extends ChannelEndpoints {
  /** The base URL for the store's mode. */
  base: string
}

/** Defaults, then the platform override, then the store's own overrides. */
export function resolveEndpoints(
  channel: MarketplaceChannel,
  creds?: { mode?: MarketplaceMode; endpoints?: Record<string, string> } | null,
  override: EndpointsOverride = platformOverride()
): ResolvedEndpoints {
  const ep = merge(DEFAULTS[channel], override[channel])
  const store = creds?.endpoints ?? {}
  const paths = { ...ep.paths }
  for (const p of ENDPOINT_PATHS) {
    const v = store[p]
    if (typeof v === 'string' && v.startsWith('/') && !v.startsWith('//')) paths[p] = v
  }
  const headers = { ...ep.headers }
  if (typeof store.pushTokenHeader === 'string' && /^[a-z0-9-]{1,64}$/i.test(store.pushTokenHeader)) headers.pushToken = store.pushTokenHeader
  const modeBase = creds?.mode === 'sandbox' ? ep.sandboxBaseUrl : ep.baseUrl
  const base = typeof store.baseUrl === 'string' && safeStoreUrl(store.baseUrl) ? store.baseUrl : modeBase
  return { ...ep, paths, headers, base: base.replace(/\/+$/, '') }
}

/** Full URL for a path with its {placeholders} filled (values are URL-encoded). */
export function endpointUrl(ep: ResolvedEndpoints, path: EndpointPath, vars: Record<string, string> = {}): string {
  const filled = ep.paths[path].replace(/\{(\w+)\}/g, (_, k: string) => {
    if (!(k in vars)) throw new Error(`Missing ${k} for the ${path} endpoint`)
    return encodeURIComponent(vars[k])
  })
  return `${ep.base}${filled}`
}
