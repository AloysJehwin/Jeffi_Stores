import { describe, it, expect, vi, beforeEach } from 'vitest'
import { boot, resetFakes } from './harness'

vi.mock('fastify', async orig => (await import('./harness')).fastifyCapture(orig as any))
vi.mock('undici', async () => { const h = await import('./harness'); return { request: (...a: any[]) => h.undiciMock(...a) } })
vi.mock('@jeffi/tenancy', async () => { const h = await import('./harness'); return { mainPool: () => ({ query: h.dbQuery }) } })

beforeEach(() => resetFakes())

describe('GET /healthz and /api/health', () => {
  it('both answer ok without credentials and never touch the storefront', async () => {
    const app = await boot()
    for (const url of ['/healthz', '/api/health']) {
      const res = await app.inject({ method: 'GET', url })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ ok: true, service: 'mobile' })
    }
    const { undiciMock } = await import('./harness')
    expect(undiciMock).not.toHaveBeenCalled()
  })
})

describe('unknown routes', () => {
  it('404s with the not_found envelope', async () => {
    const res = await (await boot()).inject({ method: 'GET', url: '/v1/nope' })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'not_found', message: 'No such endpoint' })
  })
})
