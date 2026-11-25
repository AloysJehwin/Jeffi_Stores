import { describe, it, expect, vi, beforeEach } from 'vitest'
import { boot, dbQuery, resetFakes, undiciMock } from './harness'

vi.mock('fastify', async orig => (await import('./harness')).fastifyCapture(orig as any))
vi.mock('undici', async () => { const h = await import('./harness'); return { request: (...a: any[]) => h.undiciMock(...a) } })
vi.mock('@jeffi/tenancy', async () => { const h = await import('./harness'); return { mainPool: () => ({ query: h.dbQuery }) } })

beforeEach(() => resetFakes())

// The config is cached for 60 s in module state: the failure case runs first, while the cache is empty.
describe('GET /v1/app/config', () => {
  it('502s with upstream_error when the settings read fails, and caches nothing', async () => {
    dbQuery.mockRejectedValueOnce(new Error('db down')) // the gallery probe is swallowed...
    dbQuery.mockRejectedValueOnce(new Error('db down')) // ...the settings read is not
    const res = await (await boot()).inject({ method: 'GET', url: '/v1/app/config' })
    expect(res.statusCode).toBe(502)
    expect(res.json().error).toBe('upstream_error')
  })

  it('returns the app contract: version gate, store identity, feature flags, image resizing', async () => {
    const res = await (await boot()).inject({ method: 'GET', url: '/v1/app/config' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toBe('public, max-age=60')
    expect(res.json()).toEqual({
      min_app_version: '1.0.0',
      site_url: 'https://shop.test',
      store: { name: 'Halo Audio', logo_url: '', phone: '', email: '' },
      features: { razorpay: true, cod: false },
      image_resize: true,
    })
    // the resize probe asks the storefront's /_next/image for a real gallery image
    expect(String(undiciMock.mock.calls[0][0])).toContain('http://storefront.test/_next/image?url=')
  })

  it('serves the second call from the 60 s cache without touching the DB', async () => {
    dbQuery.mockClear()
    const res = await (await boot()).inject({ method: 'GET', url: '/v1/app/config' })
    expect(res.statusCode).toBe(200)
    expect(res.json().store.name).toBe('Halo Audio')
    expect(res.headers['x-ratelimit-limit']).toBe('240')
    expect(dbQuery).not.toHaveBeenCalled()
  })
})
