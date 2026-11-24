import { describe, it, expect, vi, beforeEach } from 'vitest'

const getSiteControls = vi.hoisted(() => vi.fn())
const storefrontAiAllowed = vi.hoisted(() => vi.fn())
const resolveTenant = vi.hoisted(() => vi.fn())

vi.mock('@/lib/catalog/site-controls', () => ({ getSiteControls }))
vi.mock('@/lib/shared/storefront-ai', () => ({ storefrontAiAllowed }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenant }))

import { GET } from '@storefront/app/api/(public)/store-config/route'

const controls = () => ({
  identity: { name: 'Acme', email: 'a@b.c', phone: '1', web: 'https://a', logoUrl: '/l.png', secretField: 'x' },
  flags: { razorpayEnabled: true, upiEnabled: false, codEnabled: true, gstEnabled: true, subscriptionsEnabled: false, hiddenFlag: 1 },
  values: { orderAutoCancelMinutes: 45, smtpPassword: 'leak' },
  storefront: { featuredLimit: 8, newArrivalsLimit: 12, metaTagline: 'tag' },
})

describe('GET /api/store-config', () => {
  beforeEach(() => {
    getSiteControls.mockResolvedValue(controls())
    storefrontAiAllowed.mockResolvedValue(true)
    resolveTenant.mockResolvedValue({ slug: 'acme' })
  })

  it('returns the public config uncached, without unlisted fields', async () => {
    const res = await GET()
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    const body = await res.json()
    expect(body).toMatchObject({
      slug: 'acme',
      identity: { name: 'Acme', logoUrl: '/l.png' },
      flags: { razorpayEnabled: true, upiEnabled: false, aiStorefrontEnabled: true },
      orderAutoCancelMinutes: 45,
      storefront: { featuredLimit: 8, metaTagline: 'tag' },
    })
    expect(JSON.stringify(body)).not.toContain('leak')
    expect(body.flags).not.toHaveProperty('hiddenFlag')
    expect(body.identity).not.toHaveProperty('secretField')
  })

  it('falls back when the AI gate or tenant lookup fails', async () => {
    storefrontAiAllowed.mockRejectedValue(new Error('x'))
    resolveTenant.mockRejectedValue(new Error('y'))
    const body = await (await GET()).json()
    expect(body.flags.aiStorefrontEnabled).toBe(false)
    expect(body.slug).toBeNull()
  })

  it('surfaces a controls failure', async () => {
    getSiteControls.mockRejectedValue(new Error('db'))
    await expect(GET()).rejects.toThrow('db')
  })
})
