import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const store = new Map<string, Buffer>()
const driver = {
  name: 'local' as const,
  readLocal: vi.fn(async (k: string) => {
    const b = store.get(k)
    if (!b) throw new Error('ENOENT')
    return b
  }),
  writeLocal: vi.fn(async (k: string, b: Buffer) => void store.set(k, b)),
}
vi.mock('@/lib/vault/storage', () => ({ getStorageDriver: () => driver }))

import { GET, PUT } from '@controller/app/api/(public)/vault/local/[...path]/route'
import { signLocalToken } from '@/lib/vault/vault-storage-local'

const KEY = 'vault/t1/p1/f1.mp4'
const ctx = (key = KEY) => ({ params: Promise.resolve({ path: key.split('/') }) })
const url = (t: string, key = KEY) => `http://localhost/api/vault/local/${key}?t=${t}`
const tok = (disp: string, key = KEY, ttl = 60_000) => signLocalToken(key, Date.now() + ttl, disp)

beforeEach(() => {
  store.clear()
  store.set(KEY, Buffer.from('0123456789'))
})

describe('/api/vault/local', () => {
  it('rejects a bad, expired, or put token on GET', async () => {
    expect((await GET(new NextRequest(url('bogus')), ctx())).status).toBe(403)
    expect((await GET(new NextRequest(url(tok('inline', KEY, -1))), ctx())).status).toBe(403)
    expect((await GET(new NextRequest(url(tok('put'))), ctx())).status).toBe(403)
  })

  it('rejects a token minted for another key', async () => {
    const other = 'vault/t1/p1/other.mp4'
    store.set(other, Buffer.from('x'))
    expect((await GET(new NextRequest(url(tok('inline'), other)), ctx(other))).status).toBe(403)
  })

  it('rejects keys outside vault/ or with traversal', async () => {
    const bad = 'vault/../secret'
    expect((await GET(new NextRequest(url(tok('inline', bad), bad)), ctx(bad))).status).toBe(403)
  })

  it('forces disposition from the token and a safe type', async () => {
    const inline = await GET(new NextRequest(url(tok('inline'))), ctx())
    expect(inline.status).toBe(200)
    expect(inline.headers.get('content-disposition')).toMatch(/^inline/)
    expect(inline.headers.get('content-type')).toBe('video/mp4')
    const att = await GET(new NextRequest(url(tok('attachment'))), ctx())
    expect(att.headers.get('content-disposition')).toMatch(/^attachment/)
    expect(att.headers.get('content-type')).toBe('application/octet-stream')
  })

  it('serves html/svg as octet-stream even inline', async () => {
    const k = 'vault/t1/p1/evil.svg'
    store.set(k, Buffer.from('<svg/>'))
    const res = await GET(new NextRequest(url(tok('inline', k), k)), ctx(k))
    expect(res.headers.get('content-type')).toBe('application/octet-stream')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('supports byte ranges', async () => {
    const r = await GET(new NextRequest(url(tok('inline')), { headers: { range: 'bytes=2-4' } }), ctx())
    expect(r.status).toBe(206)
    expect(r.headers.get('content-range')).toBe('bytes 2-4/10')
    expect(await r.text()).toBe('234')
    const suffix = await GET(new NextRequest(url(tok('inline')), { headers: { range: 'bytes=-3' } }), ctx())
    expect(await suffix.text()).toBe('789')
    const bad = await GET(new NextRequest(url(tok('inline')), { headers: { range: 'bytes=50-' } }), ctx())
    expect(bad.status).toBe(416)
  })

  it('PUT requires a put token and only writes into staging', async () => {
    const k = 'vault-staging/t1/p1/new.pdf'
    const body = Buffer.from('%PDF-1.7')
    expect((await PUT(new NextRequest(url(tok('inline', k), k), { method: 'PUT', body }), ctx(k))).status).toBe(403)
    const ok = await PUT(new NextRequest(url(tok('put', k), k), { method: 'PUT', body }), ctx(k))
    expect(ok.status).toBe(200)
    expect(store.get(k)?.toString()).toBe('%PDF-1.7')
  })

  it('PUT cannot overwrite a served (promoted) file, even with a valid put token', async () => {
    const k = 'vault/t1/p1/served.pdf'
    const body = Buffer.from('<html>')
    const res = await PUT(new NextRequest(url(tok('put', k), k), { method: 'PUT', body }), ctx(k))
    expect(res.status).toBe(403)
    expect(store.has(k)).toBe(false)
  })

  it('GET never serves staging bytes', async () => {
    const k = 'vault-staging/t1/p1/new.pdf'
    store.set(k, Buffer.from('%PDF-1.7'))
    expect((await GET(new NextRequest(url(tok('inline', k), k)), ctx(k))).status).toBe(403)
  })
})
