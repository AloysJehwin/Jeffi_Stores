import { describe, it, expect, vi, beforeEach } from 'vitest'
import { boot, resetFakes, undiciMock, up } from './harness'

vi.mock('fastify', async orig => (await import('./harness')).fastifyCapture(orig as any))
vi.mock('undici', async () => { const h = await import('./harness'); return { request: (...a: any[]) => h.undiciMock(...a) } })
vi.mock('@jeffi/tenancy', async () => { const h = await import('./harness'); return { mainPool: () => ({ query: h.dbQuery }) } })

const CDN = 'https://dm9rri2wgl1e.cloudfront.net/gallery/a.jpg'
// The storefront call is the one that is not the image probe.
const storefrontCall = () => undiciMock.mock.calls.find(c => !String(c[0]).includes('/_next/image'))!

beforeEach(() => resetFakes())

describe('ALL /api/* (forwarded to the storefront)', () => {
  it('forwards a GET with the public host, client marker and the caller token', async () => {
    resetFakes(() => up(200, { products: [] }))
    const res = await (await boot()).inject({ method: 'GET', url: '/api/products?page=2', headers: { authorization: 'Bearer user-token', 'x-jeffi-image-sizing': '1' } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ products: [] })
    const [url, opts] = storefrontCall()
    expect(url).toBe('http://storefront.test/api/products?page=2')
    expect(opts.method).toBe('GET')
    expect(opts.headers).toMatchObject({ authorization: 'Bearer user-token', host: 'shop.test', 'x-forwarded-host': 'shop.test', 'x-forwarded-proto': 'https', 'x-jeffi-client': 'mobile' })
    expect(opts.headers['x-request-id']).toBeTruthy()
  })

  it('passes a JSON body to the storefront on POST and relays its status', async () => {
    resetFakes(() => up(201, { id: 'o1' }))
    const res = await (await boot()).inject({ method: 'POST', url: '/api/orders', headers: { 'content-type': 'application/json' }, payload: { cart: ['a'] } })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toEqual({ id: 'o1' })
    const [, opts] = storefrontCall()
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body)).toEqual({ cart: ['a'] })
  })

  it('relays the storefront rejecting missing or bad credentials (401)', async () => {
    resetFakes(() => up(401, { error: 'unauthorized' }))
    const res = await (await boot()).inject({ method: 'GET', url: '/api/account/me', headers: { authorization: 'Bearer expired' } })
    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'unauthorized' })
  })

  it('copies the session cookie into the JSON body as a bearer token on sign-in', async () => {
    resetFakes(() => up(200, { user: { id: 'u1' } }, { 'content-type': 'application/json', 'set-cookie': ['user_sid=abc%20123; Path=/; HttpOnly'] }))
    const res = await (await boot()).inject({ method: 'POST', url: '/api/auth/login', headers: { 'content-type': 'application/json' }, payload: { email: 'a@b.co', password: 'x' } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ user: { id: 'u1' }, token: 'abc 123' })
    expect(String(res.headers['set-cookie'])).toContain('user_sid=abc%20123')
  })

  it('points CDN image URLs in JSON at the web host resizer, unless the app sizes its own', async () => {
    resetFakes(() => up(200, { thumbnail_url: CDN, image_url: CDN }))
    const app = await boot()
    const old = await app.inject({ method: 'GET', url: '/api/products/p1' })
    expect(old.json().thumbnail_url).toBe(`https://shop.test/_next/image?url=${encodeURIComponent(CDN)}&w=384&q=70`)
    expect(old.json().image_url).toBe(`https://shop.test/_next/image?url=${encodeURIComponent(CDN)}&w=828&q=70`)
    const sizing = await app.inject({ method: 'GET', url: '/api/products/p1', headers: { 'x-jeffi-image-sizing': '1' } })
    expect(sizing.json().thumbnail_url).toBe(CDN)
  })

  it('400s on a malformed JSON body without calling the storefront', async () => {
    const res = await (await boot()).inject({ method: 'POST', url: '/api/orders', headers: { 'content-type': 'application/json' }, payload: '{not json' })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('bad_request')
    expect(storefrontCall).toBeDefined()
    expect(undiciMock.mock.calls.filter(c => !String(c[0]).includes('/_next/image'))).toHaveLength(0)
  })

  it('502s with upstream_error when the storefront is unreachable', async () => {
    resetFakes(() => { throw new Error('ECONNREFUSED') })
    const res = await (await boot()).inject({ method: 'GET', url: '/api/products', headers: { 'x-jeffi-image-sizing': '1' } })
    expect(res.statusCode).toBe(502)
    expect(res.json()).toEqual({ error: 'upstream_error', message: 'The store is not reachable right now' })
  })
})
