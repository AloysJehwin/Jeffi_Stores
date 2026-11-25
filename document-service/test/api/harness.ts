// Shared setup for the document-service route tests. server.ts builds its Fastify app at import time, so the
// fastify factory is wrapped to capture it (and never bind a port); the DB, wallet, storage and bulk worker are fakes.
import { vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { signServiceToken } from '@jeffi/service-auth'

process.env.SERVICE_AUTH_SECRET = 'test-secret'
process.env.DOCUMENTS_DATABASE_URL = 'postgres://x'
process.env.PUBLIC_BASE_URL = 'https://api.test'
delete process.env.DOCUMENTS_BUCKET

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
export const dbClient = { query: vi.fn(), release: vi.fn() }
export const pool = { query: dbQuery, connect: vi.fn(async () => dbClient) }

export const tenancyMock = async (orig: () => Promise<any>) => ({
  ...(await orig()),
  mainPool: () => pool,
  resolveServiceScope: vi.fn(async () => ({ tenantId: null, skipStoreTenants: false })),
  inScope: () => true,
  scopeSql: () => ({ sql: 'true', params: [] }),
})

export const bulk = {
  createJob: vi.fn(), getJob: vi.fn(), listJobs: vi.fn(), listItems: vi.fn(), cancelJob: vi.fn(), retryJob: vi.fn(),
  jobToApi: (j: any) => ({ id: j.id, status: j.status, succeeded: j.succeeded }),
  startWorker: vi.fn(),
  BulkItemError: class BulkItemError extends Error {},
}
export const wallet = { debit: vi.fn(), trueUp: vi.fn() }
export const storage = { putPdf: vi.fn(), getPdf: vi.fn(), pdfUrl: vi.fn(async (_key: string, fallback: string) => fallback) }
export const settings = {
  getSettings: vi.fn(), saveSettings: vi.fn(), saveLogo: vi.fn(), loadLogo: vi.fn(),
  resolveBranding: vi.fn(async () => ({ design: 'aurora', branding: { accent: '#112233', font: 'editorial' } })),
}

export const PDF = Buffer.from('%PDF-1.4 stub pdf bytes')

export const docRow = (over: Record<string, unknown> = {}) => ({
  id: 'd1', tenant_id: 't1', type: 'invoice', number: 'INV/26-27/0001', template: 'aurora', payload: {},
  totals: { subtotal: 100, cgst: 9, sgst: 9, igst: 0, total: 118 }, s3_key: 't1/invoice/d1.pdf', view_token: 'tok1',
  price_inr: '1.5', reference: 'R1', created_at: '2026-11-01T00:00:00.000Z', ...over,
})

export const auth = (claims: Record<string, unknown> = {}) => ({ authorization: `Bearer ${signServiceToken({ service: 'gateway', tenantId: 't1', ...claims } as any)}` })

export function resetFakes() {
  vi.clearAllMocks()
  dbQuery.mockReset().mockResolvedValue({ rows: [] })
  dbClient.query.mockReset().mockResolvedValue({ rows: [{ seq: '7' }] })
  wallet.debit.mockResolvedValue({ ok: true, charged: true, balance: 10 })
  storage.getPdf.mockResolvedValue(PDF)
  storage.pdfUrl.mockImplementation(async (_key: string, fallback: string) => fallback)
  settings.resolveBranding.mockResolvedValue({ design: 'aurora', branding: { accent: '#112233', font: 'editorial' } })
}

export async function boot(): Promise<FastifyInstance> {
  if (!captured.app) {
    await import('../../src/server')
    await captured.app!.ready()
  }
  return captured.app!
}
