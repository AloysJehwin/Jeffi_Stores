import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: vi.fn(async () => ({ allowed: true })) }))
vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), queryMany: vi.fn(async () => []), getClient: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: vi.fn(async () => null) }))
vi.mock('@/lib/social/accounts', () => ({ listAccounts: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => ({
  getIntegrationCredential: vi.fn(),
  saveIntegrationCredential: vi.fn(),
  deleteIntegrationCredential: vi.fn(),
}))
vi.mock('@/lib/crypto/token-cipher', () => ({
  encryptToken: (s: string) => `enc:${s}`,
  decryptToken: (s: string) => s.replace(/^enc:/, ''),
}))

import { GET, POST } from '@controller/app/api/(admin)/admin/meta-ads/console/ads/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { query, queryOne } from '@/lib/shared/db'
import { listAccounts } from '@/lib/social/accounts'
import { getIntegrationCredential } from '@/lib/tenant-registry'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const IMG = 'https://store.s3.ap-south-1.amazonaws.com/products/p/bolt.jpg'
const NEW_AD = {
  action: 'create',
  adsetId: '42',
  name: 'Bolt ad',
  imageUrl: IMG,
  link: 'https://shop.in/products/bolt',
  message: 'Strong bolts',
  headline: 'M8 bolt',
  description: 'Zinc plated',
  cta: 'SHOP_NOW',
}
const post = (body: unknown) => POST(new NextRequest('https://x/api/admin/meta-ads/console/ads', { method: 'POST', body: JSON.stringify(body) }))
const graphCalls = () =>
  fetchMock.mock.calls
    .filter(([u]) => String(u).includes('graph.facebook.com'))
    .map(([u, init]) => ({ path: String(u).replace(/^.*\/v[\d.]+\//, '').split('?')[0], method: init?.method, body: Object.fromEntries(new URLSearchParams(String(init?.body ?? ''))) }))

function route(graph: (path: string, body: Record<string, string>) => Response) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    // JPEG magic bytes: ad uploads pass JPEG/PNG through untouched (asJpegOrPng).
    if (url === IMG) return new Response(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('jpegbytes')]), { headers: { 'content-type': 'image/jpeg' } })
    const path = url.replace(/^.*\/v[\d.]+\//, '').split('?')[0]
    return graph(path, Object.fromEntries(new URLSearchParams(String(init?.body ?? ''))))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1', email: 'a@x' } as any)
  vi.mocked(getIntegrationCredential).mockResolvedValue({
    status: 'connected',
    config_enc: `enc:${JSON.stringify({ access_token: 'tok', ad_account_id: 'act_9', connected_via: 'manual' })}`,
  } as any)
  vi.mocked(listAccounts).mockResolvedValue([{ provider: 'facebook', page_id: '11', page_name: 'Jeffi', ig_user_id: null } as any])
  vi.mocked(queryOne).mockImplementation(async (sql: string) =>
    /FROM mads_adsets/.test(sql) ? { name: 'Retarget', campaign_id: '7' } : /FROM mads_ads/.test(sql) ? { name: 'Old ad', thumbnail_url: 'https://old' } : ({ id: 'log1' } as any)
  )
  route(path =>
    path.endsWith('/adimages')
      ? json({ images: { 'ad-image.jpg': { hash: 'h1' } } })
      : path.endsWith('/adcreatives')
        ? json({ id: '777' })
        : path.endsWith('/ads')
          ? json({ id: '555' })
          : json({ success: true })
  )
})

describe('Meta Ads new ad and image routes', () => {
  it('gates POST on the literal write scope and GET on read', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    expect((await post({ ...NEW_AD, preview: true })).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'meta_ads_campaigns:write')
    expect(fetchMock).not.toHaveBeenCalled()

    vi.mocked(listAccounts).mockResolvedValue([])
    const r = await GET(new NextRequest('https://x/api/admin/meta-ads/console/ads'))
    expect(requireAdminScope).toHaveBeenLastCalledWith(expect.anything(), 'meta_ads:read')
    expect(await r.json()).toEqual({ adsets: [], page: null })
  })

  it('rejects bad input before calling Meta', async () => {
    const r = await post({ ...NEW_AD, headline: 'x'.repeat(41), preview: true })
    expect(r.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('previews with validate_only and creates nothing', async () => {
    const r = await post({ ...NEW_AD, preview: true })
    const out = await r.json()
    expect(r.status).toBe(200)
    expect(out).toMatchObject({ ok: true, preview: true, problems: [] })
    const calls = graphCalls()
    expect(calls.map(c => c.path)).toEqual(['act_9/adimages', 'act_9/adcreatives', 'act_9/ads'])
    for (const c of calls.slice(1)) expect(JSON.parse(c.body.execution_options)).toEqual(['validate_only'])
    const spec = JSON.parse(calls[1].body.object_story_spec)
    expect(spec.page_id).toBe('11')
    expect(spec.link_data.image_hash).toBe('h1')
    expect(spec.link_data.link).toBe('https://shop.in/products/bolt?utm_source=facebook&utm_medium=paid_social&utm_campaign=meta_42')
    expect(JSON.parse(calls[2].body.creative).object_story_spec).toEqual(spec)
    expect(query).not.toHaveBeenCalled()
  })

  it('applies: creative, then a paused ad, recorded locally and in the change log', async () => {
    const out = await (await post({ ...NEW_AD, preview: false })).json()
    expect(out).toMatchObject({ ok: true, preview: false, result: { adId: '555', creativeId: '777', imageHash: 'h1' } })
    const calls = graphCalls()
    const ad = calls.find(c => c.path === 'act_9/ads' && !c.body.execution_options)!
    expect(ad.body).toMatchObject({ adset_id: '42', status: 'PAUSED', name: 'Bolt ad' })
    expect(JSON.parse(ad.body.creative)).toEqual({ creative_id: '777' })
    expect(vi.mocked(query).mock.calls[0][0]).toMatch(/INSERT INTO mads_ads/)
    expect(vi.mocked(query).mock.calls[0][1]).toEqual(['555', '42', '7', 'Bolt ad', 'PAUSED', IMG])
  })

  it('needs a connected Page', async () => {
    vi.mocked(listAccounts).mockResolvedValue([])
    const out = await (await post({ ...NEW_AD, preview: true })).json()
    expect(out.ok).toBe(false)
    expect(out.problems[0]).toMatch(/Facebook Page/)
    expect(graphCalls()).toEqual([])
  })

  it('maps a Meta rejection to a problem, not a 500', async () => {
    route(path => (path.endsWith('/adimages') ? json({ images: { a: { hash: 'h1' } } }) : json({ error: { message: 'Invalid parameter', error_user_msg: 'The ad set objective does not allow link ads' } }, 400)))
    const r = await post({ ...NEW_AD, preview: true })
    const out = await r.json()
    expect(r.status).toBe(200)
    expect(out).toMatchObject({ ok: false, preview: true })
    expect(out.problems[0]).toMatch(/objective does not allow/)
  })

  it('refuses images that are not ours', async () => {
    const out = await (await post({ ...NEW_AD, imageUrl: 'https://evil.example/x.jpg', preview: true })).json()
    expect(out.ok).toBe(false)
    expect(out.problems[0]).toMatch(/our own media/)
  })

  it('swaps the image of an existing ad, keeping its text and link', async () => {
    route((path, body) =>
      path === '555' && !body.creative
        ? json({ name: 'Old ad', creative: { name: 'Old creative', object_story_spec: { page_id: '11', link_data: { link: 'https://s.in', message: 'm', picture: 'p' } } } })
        : path.endsWith('/adimages')
          ? json({ images: { a: { hash: 'h2' } } })
          : path.endsWith('/adcreatives')
            ? json({ id: '888' })
            : json({ success: true })
    )
    const preview = await (await post({ action: 'image', adId: '555', imageUrl: IMG, preview: true })).json()
    expect(preview).toMatchObject({ ok: true, preview: true, before: { image: 'https://old' }, after: { image: IMG } })
    fetchMock.mockClear()
    const out = await (await post({ action: 'image', adId: '555', imageUrl: IMG })).json()
    expect(out).toMatchObject({ ok: true, result: { creativeId: '888', imageHash: 'h2' } })
    const calls = graphCalls()
    expect(JSON.parse(calls.find(c => c.path.endsWith('/adcreatives'))!.body.object_story_spec)).toEqual({
      page_id: '11',
      link_data: { link: 'https://s.in', message: 'm', image_hash: 'h2' },
    })
    const swap = calls.find(c => c.path === '555' && c.method === 'POST' && !c.body.execution_options)!
    expect(JSON.parse(swap.body.creative)).toEqual({ creative_id: '888' })
    expect(swap.body.execution_options).toBeUndefined()
  })

  it('refuses a swap on a carousel or video ad', async () => {
    route(path => (path === '555' ? json({ creative: { object_story_spec: { page_id: '11', video_data: {} } } }) : json({})))
    const out = await (await post({ action: 'image', adId: '555', imageUrl: IMG, preview: true })).json()
    expect(out.ok).toBe(false)
    expect(out.problems[0]).toMatch(/single-image link creative/)
  })
})
