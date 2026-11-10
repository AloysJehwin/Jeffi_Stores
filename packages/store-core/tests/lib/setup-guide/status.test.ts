import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryMany: vi.fn(), queryOne: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query: vi.fn() }), getIntegrationCredential: vi.fn() }))

import { RESOLVERS, detectAll, visibleSteps, platformStatus, type StatusContext } from '@/lib/setup-guide/status'
import { mergeStatus } from '@/lib/setup-guide/progress'
import { STEPS, PLATFORM_ITEMS } from '@/lib/setup-guide/registry'
import { HOW_TO } from '@/lib/setup-guide/how-to'

const T = '11111111-1111-1111-1111-111111111111'

/** A freshly provisioned store: only what provisioning/seed.ts writes, nothing connected. */
function seededStore(over: Partial<StatusContext> = {}): StatusContext {
  return {
    tenantId: T,
    now: new Date('2026-11-07T00:00:00Z'),
    settings: async () => ({ business_name: 'Acme', business_email: 'owner@crm.test' }),
    credentials: async () => [],
    kyc: async () => null,
    bank: async () => null,
    tenantRow: async () => ({ razorpay_linked_account_id: null, own_razorpay: false }),
    razorpay: async () => ({ kind: 'route', ownFlag: false, keysSet: false, lastWebhookAt: null }),
    shipping: async () => ({ ok: true, mode: 'platform' }),
    pickupLocations: async () => 0,
    codEnabled: async () => true,
    messagingLocks: async () => ({}),
    wallet: async () => null,
    domains: async () => [],
    activeAdmins: async () => 1,
    categories: async () => [{ description: 'Starter category for Apparel. Edit or remove it at any time.' }],
    brands: async () => 0,
    products: async () => ({ total: 10, withImages: 0 }),
    heroSlides: async () => [
      { image_url: null, video_url: null },
      { image_url: '', video_url: null },
    ],
    gsheet: async () => ({ state: 'not_connected' }),
    whatsappTemplates: async () => ({ approved: 0, total: 3 }),
    merchant: async () => ({ connected: false, lastStatus: null }),
    amazon: async () => false,
    marketplace: async () => null,
    lastImport: async () => null,
    googleAds: async () => ({ connected: false, pendingAccount: false }),
    amazonAds: async () => null,
    metaAds: async () => null,
    social: async () => [],
    alerts: async () => [],
    serviceAccounts: async () => 0,
    cliTokens: async () => 0,
    ...over,
  }
}

const run = (id: string, ctx: StatusContext) => RESOLVERS[id](ctx)

describe('setup guide: placeholder data from provisioning does not count', () => {
  it('shows the seeded catalogue and hero items as todo, not done', async () => {
    const ctx = seededStore()
    expect((await run('categories', ctx)).status).toBe('todo')
    expect((await run('products', ctx)).status).toBe('todo')
    expect((await run('hero', ctx)).status).toBe('todo')
    expect((await run('brands', ctx)).status).toBe('todo')
    expect((await run('categories', ctx)).detail).toMatch(/starter/i)
  })

  it('counts a real category, a product with an image and a banner with an image', async () => {
    const ctx = seededStore({
      categories: async () => [{ description: 'Starter category for Apparel. Edit or remove it at any time.' }, { description: 'Our shirts' }],
      products: async () => ({ total: 12, withImages: 2 }),
      heroSlides: async () => [{ image_url: null, video_url: null }, { image_url: 'https://cdn.crm.test/hero.jpg', video_url: null }],
      brands: async () => 1,
    })
    expect((await run('categories', ctx)).status).toBe('done')
    expect(await run('products', ctx)).toEqual({ status: 'done', detail: '2 of 12 products have images' })
    expect((await run('hero', ctx)).status).toBe('done')
    expect((await run('brands', ctx)).status).toBe('done')
  })

  it('a fresh store is mostly todo, and nothing is wrongly done', async () => {
    const d = await detectAll(seededStore(), visibleSteps(T, null))
    expect(d['store-identity']).toEqual({ status: 'todo', detail: 'Missing: logo' })
    expect(d.razorpay.status).toBe('done')
    expect(d.delhivery).toEqual({ status: 'todo', detail: 'Add a pickup location' })
    expect(d['kyc-bank'].status).toBe('todo')
    expect(d['google-ads'].status).toBe('todo')
  })
})

describe('setup guide: detected states', () => {
  it('flags an expiring Meta Ads token and a picked-but-unchosen account', async () => {
    const soon = seededStore({ metaAds: async () => ({ adAccountId: 'act_1', tokenExpiresAt: '2026-11-10T00:00:00Z', capi: true }) })
    expect((await run('meta-ads', soon)).status).toBe('needs_attention')
    const pending = seededStore({ metaAds: async () => ({ adAccountId: null, tokenExpiresAt: null, capi: false }) })
    expect((await run('meta-ads', pending)).detail).toMatch(/Choose the ad account/)
  })

  it('an open critical channel alert needs attention even when connected', async () => {
    const ctx = seededStore({ amazon: async () => true, alerts: async () => [{ severity: 'critical', status: 'open', title: 'Listings suppressed' }] })
    expect(await run('amazon', ctx)).toEqual({ status: 'needs_attention', detail: 'Listings suppressed' })
  })

  it('marketplaces in mock mode wait for the first live call', async () => {
    const ctx = seededStore({ marketplace: async () => ({ mode: 'mock' }) })
    expect((await run('myntra', ctx)).status).toBe('in_progress')
  })

  it('validates the GSTIN pattern', async () => {
    const bad = seededStore({ settings: async () => ({ business_gstin: '22AAAAA0000A1Z', feature_gst_enabled: 'true' }) })
    expect((await run('gstin', bad)).status).toBe('needs_attention')
    const good = seededStore({ settings: async () => ({ business_gstin: '22AAAAA0000A1Z5', feature_gst_enabled: 'true' }) })
    expect((await run('gstin', good)).status).toBe('done')
  })

  it('one failing check does not fail the rest', async () => {
    const d = await detectAll(seededStore({ brands: async () => Promise.reject(new Error('db down')) }), STEPS.filter(s => ['brands', 'email'].includes(s.id)))
    expect(d.brands).toEqual({ status: 'todo', detail: 'Could not check right now' })
    expect(d.email.status).toBe('done')
  })

  it('has a resolver and a walkthrough for every step', () => {
    expect(STEPS.filter(s => !RESOLVERS[s.id]).map(s => s.id)).toEqual([])
    expect(new Set(STEPS.map(s => s.id)).size).toBe(STEPS.length)
    expect(STEPS.filter(s => !HOW_TO[s.id]?.steps.length).map(s => s.id)).toEqual([])
    expect(Object.keys(HOW_TO).filter(id => !STEPS.some(s => s.id === id))).toEqual([])
  })
})

describe('setup guide: manual state', () => {
  it('fills in only where the app sees nothing; a detected state wins', () => {
    expect(mergeStatus('done', 'applied')).toBe('done')
    expect(mergeStatus('needs_attention', 'skipped')).toBe('needs_attention')
    expect(mergeStatus('in_progress', 'approved')).toBe('in_progress')
    expect(mergeStatus('todo', 'applied')).toBe('in_progress')
    expect(mergeStatus('todo', 'approved')).toBe('done')
    expect(mergeStatus('todo', 'skipped')).toBe('skipped')
    expect(mergeStatus('todo', null)).toBe('todo')
  })

  it('platform items: missing keys with an approval need attention; key-only items are done with keys', () => {
    const meta = PLATFORM_ITEMS.find(i => i.id === 'meta-app')!
    expect(platformStatus(meta, 'approved', {})).toBe('needs_attention')
    expect(platformStatus(meta, 'applied', { META_APP_ID: '1', META_APP_SECRET: 's' })).toBe('in_progress')
    expect(platformStatus(meta, null, { META_APP_ID: '1', META_APP_SECRET: 's' })).toBe('todo')
    const x = PLATFORM_ITEMS.find(i => i.id === 'x-api')!
    expect(platformStatus(x, null, { X_CLIENT_ID: '1', X_CLIENT_SECRET: 's' })).toBe('done')
  })
})

describe('setup guide: visibility', () => {
  it('hides steps the plan does not sell, and store-only steps on the flagship', () => {
    const basic = new Set(['settings:read', 'orders:read', 'products:read', 'categories:read', 'brands:read', 'delhivery:read'])
    const ids = visibleSteps(T, basic).map(s => s.id)
    expect(ids).toContain('razorpay')
    expect(ids).toContain('wallet')
    expect(ids).not.toContain('google-ads')
    expect(ids).not.toContain('myntra')
    const flagship = visibleSteps(null, null).map(s => s.id)
    expect(flagship).toContain('google-ads')
    expect(flagship).not.toContain('kyc-bank')
    expect(flagship).not.toContain('custom-domain')
  })
})
