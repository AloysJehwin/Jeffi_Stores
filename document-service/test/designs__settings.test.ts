import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- mocks ---
const getPdfMock = vi.fn()
const putObjectMock = vi.fn().mockResolvedValue(undefined)
vi.mock('../src/storage.js', () => ({ getPdf: (...a: any[]) => getPdfMock(...a), putObject: (...a: any[]) => putObjectMock(...a) }))

// sharp: a chainable stub whose toBuffer resolves to a PNG-ish buffer, overridable per test.
const toBufferMock = vi.fn().mockResolvedValue(Buffer.from('png'))
const sharpChain = { resize: vi.fn().mockReturnThis(), png: vi.fn().mockReturnThis(), toBuffer: (...a: any[]) => toBufferMock(...a) }
const sharpMock = vi.fn(() => sharpChain)
vi.mock('sharp', () => ({ default: (...a: any[]) => sharpMock(...a) }))

const lookupMock = vi.fn()
vi.mock('node:dns/promises', () => ({ lookup: (...a: any[]) => lookupMock(...a) }))

// node:https stand-in: runs the request's lookup (as Node would at connect time), then answers with httpsMock(url, addrs).
const { httpsMock } = vi.hoisted(() => ({ httpsMock: vi.fn() }))
vi.mock('node:https', async () => {
  const { EventEmitter } = await import('node:events')
  const { isIP } = await import('node:net')
  return { default: { request: (url: URL, opts: any, cb: (r: any) => void) => {
    const req: any = new EventEmitter()
    const answer = (addrs: any[]) => Promise.resolve().then(() => httpsMock(url, addrs)).then(cb, (e: Error) => req.emit('error', e))
    // Node skips the lookup for IP literals.
    req.end = () => isIP(url.hostname.replace(/^\[|\]$/g, '')) ? answer([]) : opts.lookup(url.hostname, { all: true }, (err: Error | null, addrs: any[]) => err ? req.emit('error', err) : answer(addrs))
    return req
  } } }
})
const reply = (statusCode: number, body: Buffer = Buffer.alloc(0)) => {
  const r: any = Readable.from([body]); r.statusCode = statusCode; r.headers = {}; return r
}

import { Readable } from 'node:stream'
import {
  getSettings, saveSettings, normalizeLogo, saveLogo, loadLogo, resolveBranding,
} from '../src/designs/settings.js'

const fakeDb = (rows: any[]) => ({ query: vi.fn().mockResolvedValue({ rows }) }) as any

beforeEach(() => {
  getPdfMock.mockReset()
  putObjectMock.mockClear().mockResolvedValue(undefined)
  toBufferMock.mockReset().mockResolvedValue(Buffer.from('png'))
  sharpMock.mockClear(); sharpChain.resize.mockClear(); sharpChain.png.mockClear()
  lookupMock.mockReset()
  httpsMock.mockReset()
  vi.restoreAllMocks()
})

describe('getSettings', () => {
  it('returns the row when present', async () => {
    const row = { design: 'ledger', accent: '#112233', font: 'modern', logo_key: 't/logo.png' }
    const db = fakeDb([row])
    expect(await getSettings(db, 't1')).toEqual(row)
    expect(db.query.mock.calls[0][1]).toEqual(['t1'])
  })
  it('returns EMPTY defaults when no row', async () => {
    expect(await getSettings(fakeDb([]), 't1')).toEqual({ design: null, accent: null, font: null, logo_key: null })
  })
})

describe('saveSettings', () => {
  it('upserts valid values and returns getSettings', async () => {
    const saved = { design: 'ledger', accent: '#aabbcc', font: 'modern', logo_key: null }
    // first query = INSERT, second = SELECT in getSettings
    const db = { query: vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [saved] }) } as any
    const out = await saveSettings(db, 't1', { design: 'ledger', accent: '#aabbcc', font: 'modern' })
    expect(out).toEqual(saved)
    expect(db.query.mock.calls[0][1]).toEqual(['t1', 'ledger', '#aabbcc', 'modern'])
  })
  it('throws bad() for unknown design', async () => {
    await expect(saveSettings(fakeDb([]), 't1', { design: 'nope' })).rejects.toMatchObject({ status: 400, code: 'validation_error' })
  })
  it('throws bad() for a bad accent', async () => {
    await expect(saveSettings(fakeDb([]), 't1', { accent: 'red' })).rejects.toMatchObject({ status: 400, code: 'validation_error' })
  })
  it('throws bad() for an unknown font', async () => {
    await expect(saveSettings(fakeDb([]), 't1', { font: 'comic' })).rejects.toMatchObject({ status: 400, code: 'validation_error' })
  })
})

describe('normalizeLogo', () => {
  it('runs the sharp resize/png/toBuffer chain', async () => {
    const out = await normalizeLogo(Buffer.from('raw'))
    expect(sharpMock).toHaveBeenCalledWith(expect.any(Buffer))
    expect(sharpChain.resize).toHaveBeenCalledWith({ width: 600, height: 600, fit: 'inside', withoutEnlargement: true })
    expect(sharpChain.png).toHaveBeenCalled()
    expect(out.toString()).toBe('png')
  })
})

describe('saveLogo', () => {
  it('normalizes + putObject with the tenant-scoped key when raw present', async () => {
    const db = { query: vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ logo_key: 't1/branding/logo.png' }] }) } as any
    await saveLogo(db, 't1', Buffer.from('img'))
    expect(putObjectMock).toHaveBeenCalledWith('t1/branding/logo.png', Buffer.from('png'), 'image/png')
    expect(db.query.mock.calls[0][1]).toEqual(['t1', 't1/branding/logo.png'])
  })
  it('stores a null key when raw is null (no putObject)', async () => {
    const db = { query: vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ logo_key: null }] }) } as any
    await saveLogo(db, 't1', null)
    expect(putObjectMock).not.toHaveBeenCalled()
    expect(db.query.mock.calls[0][1]).toEqual(['t1', null])
  })
  it('throws bad() when sharp fails to decode', async () => {
    toBufferMock.mockRejectedValue(new Error('bad image'))
    await expect(saveLogo(fakeDb([]), 't1', Buffer.from('x'))).rejects.toMatchObject({ status: 400, code: 'validation_error' })
    expect(putObjectMock).not.toHaveBeenCalled()
  })
})

describe('loadLogo', () => {
  it('returns null for a null key (no getPdf)', async () => {
    expect(await loadLogo(null)).toBeNull()
    expect(getPdfMock).not.toHaveBeenCalled()
  })
  it('returns the buffer from getPdf for a key', async () => {
    getPdfMock.mockResolvedValue(Buffer.from('logo'))
    const out = await loadLogo('t1/logo.png')
    expect(out?.toString()).toBe('logo')
  })
  it('returns null when getPdf rejects', async () => {
    getPdfMock.mockRejectedValue(new Error('missing'))
    expect(await loadLogo('t1/logo.png')).toBeNull()
  })
})

describe('resolveBranding', () => {
  it('throws for an invalid call accent', async () => {
    await expect(resolveBranding(fakeDb([]), 't1', null, { accent: 'nope' }))
      .rejects.toMatchObject({ status: 400, code: 'validation_error' })
  })
  it('throws for an invalid call font', async () => {
    await expect(resolveBranding(fakeDb([]), 't1', null, { font: 'bogus' }))
      .rejects.toMatchObject({ status: 400, code: 'validation_error' })
  })
  it('loads the stored logo when no logo_url, and resolves design = template ?? s.design', async () => {
    getPdfMock.mockResolvedValue(Buffer.from('stored'))
    const s = { design: 'ledger', accent: '#111111', font: 'modern', logo_key: 't1/logo.png' }
    const out = await resolveBranding(fakeDb([s]), 't1')
    expect(out.design).toBe('ledger') // from s.design
    expect(out.branding.logo?.toString()).toBe('stored')
    expect(out.branding.accent).toBe('#111111')
    expect(out.branding.font).toBe('modern')
  })
  it('template overrides stored design; call accent/font override stored', async () => {
    getPdfMock.mockResolvedValue(null)
    const s = { design: 'ledger', accent: '#111111', font: 'modern', logo_key: null }
    const out = await resolveBranding(fakeDb([s]), 't1', 'grid', { accent: '#abcdef', font: 'classic' })
    expect(out.design).toBe('grid')
    expect(out.branding.accent).toBe('#abcdef')
    expect(out.branding.font).toBe('classic')
    expect(out.branding.logo).toBeNull()
  })
  it('design is null when no template and no stored design', async () => {
    const out = await resolveBranding(fakeDb([{ design: null, accent: null, font: null, logo_key: null }]), 't1')
    expect(out.design).toBeNull()
  })

  // --- fetchLogo branches, reached via logo_url ---
  it('rejects an invalid logo_url', async () => {
    await expect(resolveBranding(fakeDb([]), 't1', null, { logo_url: 'not a url' }))
      .rejects.toMatchObject({ status: 400, code: 'validation_error' })
  })
  it('rejects a non-https logo_url', async () => {
    await expect(resolveBranding(fakeDb([]), 't1', null, { logo_url: 'http://example.com/logo.png' }))
      .rejects.toMatchObject({ status: 400 })
  })
  it('rejects a private resolved address', async () => {
    lookupMock.mockResolvedValue([{ address: '10.0.0.5' }])
    await expect(resolveBranding(fakeDb([]), 't1', null, { logo_url: 'https://internal.example/logo.png' }))
      .rejects.toMatchObject({ status: 400 })
  })
  it('rejects when host lookup fails', async () => {
    lookupMock.mockRejectedValue(new Error('nxdomain'))
    await expect(resolveBranding(fakeDb([]), 't1', null, { logo_url: 'https://nope.example/logo.png' }))
      .rejects.toMatchObject({ status: 400 })
  })
  it('rejects when the response is not 2xx (a redirect is a failure too)', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34' }])
    httpsMock.mockResolvedValue(reply(404))
    await expect(resolveBranding(fakeDb([]), 't1', null, { logo_url: 'https://cdn.example/logo.png' }))
      .rejects.toMatchObject({ status: 400, message: 'branding.logo_url could not be fetched' })
    httpsMock.mockResolvedValue(reply(302))
    await expect(resolveBranding(fakeDb([]), 't1', null, { logo_url: 'https://cdn.example/logo.png' }))
      .rejects.toMatchObject({ status: 400, message: 'branding.logo_url could not be fetched' })
  })
  it('rejects a transport error', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34' }])
    httpsMock.mockRejectedValue(new Error('ECONNRESET'))
    await expect(resolveBranding(fakeDb([]), 't1', null, { logo_url: 'https://cdn.example/logo.png' }))
      .rejects.toMatchObject({ status: 400, message: 'branding.logo_url could not be fetched' })
  })
  it('rejects a body larger than 2 MB while streaming', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34' }])
    httpsMock.mockResolvedValue(reply(200, Buffer.alloc(2_000_001)))
    await expect(resolveBranding(fakeDb([]), 't1', null, { logo_url: 'https://cdn.example/logo.png' }))
      .rejects.toMatchObject({ status: 400, message: 'branding.logo_url is larger than 2 MB' })
  })
  it('fetches, normalizes and returns the logo on success', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34' }])
    httpsMock.mockResolvedValue(reply(200, Buffer.from([1, 2, 3])))
    const out = await resolveBranding(fakeDb([{ design: null, accent: null, font: null, logo_key: null }]), 't1', null, { logo_url: 'https://cdn.example/logo.png' })
    expect(sharpMock).toHaveBeenCalled()
    expect(out.branding.logo?.toString()).toBe('png')
  })
  it('refuses a host that resolves public for the pre-check but private at connect time, without connecting', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '93.184.216.34' }]).mockResolvedValueOnce([{ address: '10.0.0.5' }])
    await expect(resolveBranding(fakeDb([]), 't1', null, { logo_url: 'https://rebind.example/logo.png' }))
      .rejects.toMatchObject({ status: 400, message: 'branding.logo_url must be a public address' })
    expect(lookupMock).toHaveBeenCalledTimes(2)
    expect(httpsMock).not.toHaveBeenCalled()
  })
  it('refuses private IP literals without connecting', async () => {
    for (const ip of ['10.0.0.5', '127.0.0.1', '169.254.169.254', '[::1]', '[fd00::1]']) {
      await expect(resolveBranding(fakeDb([]), 't1', null, { logo_url: `https://${ip}/logo.png` }))
        .rejects.toMatchObject({ status: 400, message: 'branding.logo_url must be a public address' })
    }
    expect(httpsMock).not.toHaveBeenCalled()
  })
  it('skips DNS lookup when host is already an IP (literal)', async () => {
    httpsMock.mockResolvedValue(reply(200, Buffer.from([9])))
    const out = await resolveBranding(fakeDb([{ design: null, accent: null, font: null, logo_key: null }]), 't1', null, { logo_url: 'https://93.184.216.34/logo.png' })
    expect(lookupMock).not.toHaveBeenCalled()
    expect(out.branding.logo?.toString()).toBe('png')
  })
})
