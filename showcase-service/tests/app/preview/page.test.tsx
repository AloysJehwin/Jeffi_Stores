// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// The preview page: the current page of a draft on its own host, the live site once a link has run out after
// publish, a note otherwise, and nothing for a bad token or another host. Never indexed, no referrer.

const h = vi.hoisted(() => ({
  checkShowcasePreviewToken: vi.fn(),
  getShowcaseById: vi.fn(),
  requestHost: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { to })
  }),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))
vi.mock('@/lib/showcase/preview-token', () => ({ checkShowcasePreviewToken: h.checkShowcasePreviewToken }))
vi.mock('@/lib/showcase/store', () => ({ getShowcaseById: h.getShowcaseById }))
vi.mock('@showcase/lib/site', () => ({ requestHost: h.requestHost }))
vi.mock('next/navigation', () => ({ redirect: h.redirect, notFound: h.notFound }))
vi.mock('@/components/visitor/site/PhotoCredits', () => ({ default: () => null }))
vi.mock('@/lib/ai/stock-credits', () => ({ pageCredits: () => [], pictureCredits: () => [] }))
vi.mock('@/lib/site/data', () => ({ runWithSiteData: (_d: unknown, fn: () => unknown) => fn() }))
vi.mock('@/lib/showcase/site-data', () => ({ showcaseSiteData: (v: { leadEndpoint: string | null }) => ({ lead: v.leadEndpoint }) }))
vi.mock('@showcase/app/SiteSections', () => ({
  default: ({ doc, data }: { doc: { order: string[] }; data: { lead: string | null } }) =>
    createElement('div', { 'data-sections': doc.order.join(','), 'data-lead': String(data.lead) }),
}))
vi.mock('@showcase/app/preview/PreviewClient', () => ({
  default: ({ token, state }: { token: string; state: { status: string; expiresAt: string } }) =>
    createElement('div', { 'data-preview': token, 'data-status': state.status, 'data-expires': state.expiresAt }),
}))

import PreviewPage, { generateMetadata } from '@showcase/app/preview/page'

const HOST = 'site-latte.jeffistores.in'
const PAGE = { order: ['hero', 'about'], blocks: { hero: { id: 'hero', type: 'code_section', v: 1, props: { compiled: { id: 'hero', ast: {} } } }, about: { id: 'about', type: 'code_section', v: 1, props: { compiled: { id: 'about', ast: {} } } } } }
const SITE = {
  id: 's-1', slug: 'latte', customDomain: null, status: 'draft', workspaceSuspended: false, updatedAt: '2026-11-24T10:00:00.000Z',
  business: { name: 'Latte Cafe' }, content: { services: [], pictures: [] }, theme: null, page: PAGE,
}
const props = (t?: string | string[]) => ({ searchParams: Promise.resolve(t === undefined ? {} : { t }) })
const html = async (t?: string | string[]) => renderToStaticMarkup(await PreviewPage(props(t)))

describe('/preview', () => {
  beforeEach(() => {
    h.requestHost.mockResolvedValue(HOST)
    h.checkShowcasePreviewToken.mockResolvedValue({ state: 'valid', siteId: 's-1', jti: 'j', expiresAt: '2026-11-25T10:00:00.000Z' })
    h.getShowcaseById.mockResolvedValue(SITE)
  })

  it('renders the current draft page with inert forms and the live poller', async () => {
    const out = await html('tok')
    expect(out).toContain('data-sections="hero,about"')
    expect(out).toContain('data-lead="null"')
    expect(out).toContain('data-preview="tok"')
    expect(out).toContain('data-status="draft"')
    expect(out).toContain('data-expires="2026-11-25T10:00:00.000Z"')
  })

  it('says the site is being built while it has no page yet', async () => {
    h.getShowcaseById.mockResolvedValue({ ...SITE, page: null })
    const out = await html('tok')
    expect(out).toContain('Your site is being built')
    expect(out).toContain('data-preview="tok"')
  })

  it('goes to the live site once an expired link names a published site', async () => {
    h.checkShowcasePreviewToken.mockResolvedValue({ state: 'expired', siteId: 's-1', jti: 'j' })
    h.getShowcaseById.mockResolvedValue({ ...SITE, status: 'live' })
    await expect(html('tok')).rejects.toMatchObject({ to: '/' })
  })

  it('shows the expired note when the site is not live', async () => {
    h.checkShowcasePreviewToken.mockResolvedValue({ state: 'revoked', siteId: 's-1', jti: 'j' })
    const out = await html('tok')
    expect(out).toContain('This preview link has expired')
    expect(out).not.toContain('data-sections')
    expect(h.redirect).not.toHaveBeenCalled()
  })

  it("is not found for another site's host, a bad token, or no token", async () => {
    h.requestHost.mockResolvedValue('site-brew.jeffistores.in')
    await expect(html('tok')).rejects.toThrow('NEXT_NOT_FOUND')
    h.requestHost.mockResolvedValue(HOST)
    h.checkShowcasePreviewToken.mockResolvedValue({ state: 'invalid' })
    await expect(html('tok')).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(html()).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(html(['a', 'b'])).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('is never indexed and sends no referrer', async () => {
    expect(await generateMetadata(props('tok'))).toEqual({ title: 'Latte Cafe (preview)', robots: { index: false, follow: false, nocache: true }, referrer: 'no-referrer' })
    h.checkShowcasePreviewToken.mockResolvedValue({ state: 'invalid' })
    expect(await generateMetadata(props('bad'))).toMatchObject({ title: 'Preview', robots: { index: false, follow: false }, referrer: 'no-referrer' })
  })
})
