import { describe, it, expect, vi, beforeEach } from 'vitest'
import { auth, boot, resetFakes, settings } from './harness'

vi.mock('fastify', async orig => (await import('./harness')).fastifyCapture(orig as any))
vi.mock('@jeffi/tenancy', async orig => (await import('./harness')).tenancyMock(orig as any))
vi.mock('@jeffi/bulk', async () => (await import('./harness')).bulk)
vi.mock('@jeffi/wallet', async () => (await import('./harness')).wallet)
vi.mock('../../src/storage.js', async () => (await import('./harness')).storage)
vi.mock('../../src/designs/settings.js', async () => (await import('./harness')).settings)
vi.mock('../../src/tenant/public.js', () => ({ publicRoutes: async () => {} }))
vi.mock('../../src/admin/index.js', () => ({ adminRoutes: async () => {} }))

const stored = { design: 'aurora', accent: '#112233', font: 'editorial', logo_key: null as string | null }

beforeEach(() => {
  resetFakes()
  settings.getSettings.mockResolvedValue({ ...stored })
  settings.saveSettings.mockImplementation(async (_db: unknown, _t: string, b: any) => ({ ...stored, ...b }))
  settings.saveLogo.mockImplementation(async (_db: unknown, _t: string, raw: Buffer | null) => ({ ...stored, logo_key: raw ? 't1/logo.png' : null }))
  settings.loadLogo.mockResolvedValue(null)
})

describe('GET /designs', () => {
  it('lists designs with thumbnail urls, fonts and the default', async () => {
    const res = await (await boot()).inject({ method: 'GET', url: '/designs', headers: auth() })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.designs.length).toBeGreaterThan(5)
    expect(body.designs[0].thumbnail_url).toBe(`/designs/${body.designs[0].key}/thumbnail.png`)
    expect(body.fonts.length).toBeGreaterThan(0)
    expect(body.default).toBe('aurora')
  })

  it('401s without a token', async () => {
    expect((await (await boot()).inject({ method: 'GET', url: '/designs' })).statusCode).toBe(401)
  })
})

describe('GET /designs/:key/thumbnail.png (public)', () => {
  it('serves the PNG with no token', async () => {
    const res = await (await boot()).inject({ method: 'GET', url: '/designs/aurora/thumbnail.png' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
    expect(res.headers['cache-control']).toContain('max-age=86400')
    expect(res.rawPayload.subarray(1, 4).toString()).toBe('PNG')
  })

  it('404s for an unknown design', async () => {
    const res = await (await boot()).inject({ method: 'GET', url: '/designs/no-such/thumbnail.png' })
    expect(res.statusCode).toBe(404)
    expect(res.json().error).toBe('not_found')
  })
})

describe('GET /designs/:key/preview/:type', () => {
  it('renders a sample PDF with the PDF content type and header', async () => {
    const res = await (await boot()).inject({ method: 'GET', url: '/designs/aurora/preview/invoice?accent=%23aa5500&font=editorial', headers: auth() })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('application/pdf')
    expect(res.headers['content-disposition']).toContain('aurora-invoice.pdf')
    expect(res.rawPayload.subarray(0, 4).toString()).toBe('%PDF')
    expect(settings.resolveBranding).toHaveBeenCalledWith(expect.anything(), 't1', null, { accent: '#aa5500', font: 'editorial' })
  })

  it('404s an unknown design, 400s an unknown type or font, 401s without a token', async () => {
    const app = await boot()
    const unknown = await app.inject({ method: 'GET', url: '/designs/no-such/preview/invoice', headers: auth() })
    expect(unknown.statusCode).toBe(404)
    expect(unknown.json().error).toBe('unknown_template')
    const badType = await app.inject({ method: 'GET', url: '/designs/aurora/preview/bogus', headers: auth() })
    expect(badType.statusCode).toBe(400)
    expect(badType.json().error).toBe('validation_error')
    expect((await app.inject({ method: 'GET', url: '/designs/aurora/preview/invoice?font=comic', headers: auth() })).statusCode).toBe(400)
    expect((await app.inject({ method: 'GET', url: '/designs/aurora/preview/invoice' })).statusCode).toBe(401)
  })
})

describe('GET and PUT /settings', () => {
  it('GET returns the workspace document settings', async () => {
    const res = await (await boot()).inject({ method: 'GET', url: '/settings', headers: auth() })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ design: 'aurora', accent: '#112233', font: 'editorial', has_logo: false })
    expect(settings.getSettings).toHaveBeenCalledWith(expect.anything(), 't1')
  })

  it('PUT saves a valid update', async () => {
    const res = await (await boot()).inject({ method: 'PUT', url: '/settings', headers: auth(), payload: { design: 'ledger', accent: '#aabbcc' } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ design: 'ledger', accent: '#aabbcc' })
    expect(settings.saveSettings).toHaveBeenCalledWith(expect.anything(), 't1', { design: 'ledger', accent: '#aabbcc' })
  })

  it('PUT 400s on a bad colour; both 401 without a token', async () => {
    const app = await boot()
    const bad = await app.inject({ method: 'PUT', url: '/settings', headers: auth(), payload: { accent: 'red' } })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().error).toBe('validation_error')
    expect(settings.saveSettings).not.toHaveBeenCalled()
    expect((await app.inject({ method: 'GET', url: '/settings' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'PUT', url: '/settings', payload: {} })).statusCode).toBe(401)
  })
})

describe('GET and POST /settings/logo', () => {
  it('GET serves the saved logo as an image', async () => {
    settings.getSettings.mockResolvedValueOnce({ ...stored, logo_key: 't1/logo.png' })
    settings.loadLogo.mockResolvedValueOnce(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const res = await (await boot()).inject({ method: 'GET', url: '/settings/logo', headers: auth() })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
    expect(res.headers['cache-control']).toBe('no-store')
    expect(settings.loadLogo).toHaveBeenCalledWith('t1/logo.png')
  })

  it('GET 404s when no logo is set, and 401s without a token', async () => {
    const app = await boot()
    const none = await app.inject({ method: 'GET', url: '/settings/logo', headers: auth() })
    expect(none.statusCode).toBe(404)
    expect(none.json().message).toBe('No logo set')
    expect((await app.inject({ method: 'GET', url: '/settings/logo' })).statusCode).toBe(401)
  })

  it('POST stores a base64 logo (data URL prefix stripped); null removes it', async () => {
    const app = await boot()
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    const set = await app.inject({ method: 'POST', url: '/settings/logo', headers: auth(), payload: { data: `data:image/png;base64,${png.toString('base64')}` } })
    expect(set.statusCode).toBe(200)
    expect(set.json().has_logo).toBe(true)
    expect(settings.saveLogo.mock.calls[0][2]).toEqual(png)
    const cleared = await app.inject({ method: 'POST', url: '/settings/logo', headers: auth(), payload: { data: null } })
    expect(cleared.json().has_logo).toBe(false)
    expect(settings.saveLogo.mock.calls[1][2]).toBeNull()
  })

  it('POST 400s on a logo over 1 MB; 401s without a token', async () => {
    const app = await boot()
    const big = Buffer.alloc(1_100_000, 1).toString('base64')
    const res = await app.inject({ method: 'POST', url: '/settings/logo', headers: auth(), payload: { data: big } })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toContain('1 MB')
    expect((await app.inject({ method: 'POST', url: '/settings/logo', payload: { data: null } })).statusCode).toBe(401)
  })
})
