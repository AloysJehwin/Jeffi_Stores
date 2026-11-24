// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Which site a preview token opens, and on which host: only the token's own site, only on its address.

const { checkShowcasePreviewToken, getShowcaseById } = vi.hoisted(() => ({ checkShowcasePreviewToken: vi.fn(), getShowcaseById: vi.fn() }))
vi.mock('@/lib/showcase/preview-token', () => ({ checkShowcasePreviewToken }))
vi.mock('@/lib/showcase/store', () => ({ getShowcaseById }))

import { loadPreview, previewState, sectionHashes, siteServesHost } from '@showcase/lib/preview'

const SITE = { id: 's-1', slug: 'latte', customDomain: 'latte.in', status: 'draft', workspaceSuspended: false, updatedAt: '2026-11-24T10:00:00.000Z', page: null }
const doc = (texts: Record<string, string>) => ({
  order: Object.keys(texts),
  blocks: Object.fromEntries(Object.entries(texts).map(([id, t]) => [id, { id, type: 'code_section', v: 1, props: { compiled: { id, ast: { t } } } }])),
})

describe('siteServesHost', () => {
  it('matches its own site- address and custom domain, nothing else', () => {
    expect(siteServesHost(SITE, 'site-latte.jeffistores.in')).toBe(true)
    expect(siteServesHost(SITE, 'site-latte.localhost:3000')).toBe(true)
    expect(siteServesHost(SITE, 'latte.in')).toBe(true)
    expect(siteServesHost(SITE, 'www.latte.in')).toBe(true)
    expect(siteServesHost(SITE, 'site-brew.jeffistores.in')).toBe(false)
    expect(siteServesHost(SITE, 'evil.example')).toBe(false)
    expect(siteServesHost({ slug: 'latte', customDomain: null }, 'latte.in')).toBe(false)
    expect(siteServesHost(SITE, '')).toBe(false)
  })
})

describe('loadPreview', () => {
  beforeEach(() => {
    checkShowcasePreviewToken.mockResolvedValue({ state: 'valid', siteId: 's-1', jti: 'j', expiresAt: '2026-11-25T10:00:00.000Z' })
    getShowcaseById.mockResolvedValue(SITE)
  })

  it("opens the token's site on its host, a draft too", async () => {
    expect(await loadPreview('tok', 'site-latte.jeffistores.in')).toEqual({ kind: 'ok', site: SITE, expiresAt: '2026-11-25T10:00:00.000Z' })
    expect(getShowcaseById).toHaveBeenCalledWith('s-1')
  })

  it("rejects the token on another site's host", async () => {
    expect(await loadPreview('tok', 'site-brew.jeffistores.in')).toEqual({ kind: 'invalid' })
  })

  it('rejects a bad token without reading any site', async () => {
    checkShowcasePreviewToken.mockResolvedValue({ state: 'invalid' })
    expect(await loadPreview('tok', 'site-latte.jeffistores.in')).toEqual({ kind: 'invalid' })
    checkShowcasePreviewToken.mockRejectedValue(new Error('db down'))
    expect(await loadPreview('tok', 'site-latte.jeffistores.in')).toEqual({ kind: 'invalid' })
    expect(getShowcaseById).not.toHaveBeenCalled()
  })

  it('reports an expired or revoked link with its site, and a suspended workspace as expired', async () => {
    checkShowcasePreviewToken.mockResolvedValue({ state: 'revoked', siteId: 's-1', jti: 'j' })
    expect(await loadPreview('tok', 'site-latte.jeffistores.in')).toEqual({ kind: 'expired', site: SITE })
    checkShowcasePreviewToken.mockResolvedValue({ state: 'valid', siteId: 's-1', jti: 'j', expiresAt: 'x' })
    getShowcaseById.mockResolvedValue({ ...SITE, workspaceSuspended: true })
    expect((await loadPreview('tok', 'site-latte.jeffistores.in')).kind).toBe('expired')
  })
})

describe('sectionHashes / previewState', () => {
  it('hashes each section, so a change shows in its hash only', () => {
    const a = sectionHashes(doc({ hero: 'Hi', about: 'Us' }) as never)
    const b = sectionHashes(doc({ hero: 'Hello', about: 'Us' }) as never)
    expect(Object.keys(a)).toEqual(['hero', 'about'])
    expect(a.about).toBe(b.about)
    expect(a.hero).not.toBe(b.hero)
    expect(sectionHashes(null)).toEqual({})
  })

  it('says what the poller needs and no content', () => {
    const s = previewState({ ...SITE, status: 'live', page: doc({ hero: 'Hi' }) } as never, '2026-11-24T10:30:00.000Z')
    expect(s).toEqual({ version: SITE.updatedAt, status: 'live', live: true, expiresAt: '2026-11-24T10:30:00.000Z', sections: { hero: expect.any(String) } })
  })
})
