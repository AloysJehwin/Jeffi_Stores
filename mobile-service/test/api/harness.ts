// Shared setup for the mobile-service route tests. server.ts builds its Fastify app at import time and listens,
// so the fastify factory is wrapped to capture the app (never binding a port); the DB pool and undici are fakes.
import { vi } from 'vitest'
import { Readable } from 'node:stream'
import type { FastifyInstance } from 'fastify'

process.env.DATABASE_URL = 'postgres://x'
process.env.STOREFRONT_URL = 'http://storefront.test'
process.env.PUBLIC_SITE_URL = 'https://shop.test'
process.env.EDGE_ORIGIN_SECRET = 'edge-secret'
delete process.env.REDIS_URL
delete process.env.APP_IMAGE_RESIZE
delete process.env.MIN_APP_VERSION

const captured: { app?: FastifyInstance } = {}

export const fastifyCapture = async (orig: () => Promise<any>) => {
  const mod = await orig()
  const factory = (opts?: any) => {
    const app = mod.default(opts)
    app.listen = async () => ''
    captured.app = app
    return app
  }
  return { ...mod, default: Object.assign(factory, mod.default) }
}

export const dbQuery = vi.fn()
export const undiciMock = vi.fn()

/** undici-shaped upstream response. */
export function up(status = 200, body: unknown = { ok: true }, headers: Record<string, string | string[]> = { 'content-type': 'application/json' }) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return {
    statusCode: status,
    headers,
    body: Object.assign(Readable.from([Buffer.from(text)]), {
      text: async () => text,
      json: async () => JSON.parse(text),
      dump: async () => {},
    }),
  } as any
}

export const GALLERY = { rows: [{ url: 'https://dm9rri2wgl1e.cloudfront.net/gallery/a.jpg' }] }

/** DB: gallery probe row + site settings rows; storefront: the image probe answers 200, anything else is `upstream`. */
export function resetFakes(upstream: () => any = () => up()) {
  vi.clearAllMocks()
  dbQuery.mockReset().mockImplementation(async (sql: string) => {
    if (sql.includes('gallery_images')) return GALLERY
    if (sql.includes('site_settings')) return { rows: [{ key: 'business_name', value: 'Halo Audio' }, { key: 'feature_cod_enabled', value: 'false' }] }
    return { rows: [] }
  })
  undiciMock.mockReset().mockImplementation(async (url: string) => (String(url).includes('/_next/image') ? up(200, '') : upstream()))
}

export async function boot(): Promise<FastifyInstance> {
  if (!captured.app) {
    await import('../../src/server')
    await captured.app!.ready()
  }
  return captured.app!
}
