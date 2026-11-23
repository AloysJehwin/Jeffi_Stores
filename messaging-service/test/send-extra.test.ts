import { describe, it, expect, vi, beforeEach } from 'vitest'

const dbState = { tenants: new Map<string, any>() }
vi.mock('../src/db.js', () => ({
  db: { query: vi.fn(async (sql: string, params: any[] = []) => {
    if (sql.includes('FROM tenants WHERE id=$1')) return { rows: dbState.tenants.get(params[0]) ? [dbState.tenants.get(params[0])] : [] }
    if (sql.includes('INSERT INTO short_link')) return { rows: [], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  }) },
  one: vi.fn(async () => undefined),
}))
vi.mock('../src/pools.js', () => ({ poolsForTenant: vi.fn() }))
vi.mock('../src/governance.js', () => ({ getSettings: vi.fn(), standardAllowed: vi.fn(() => true) }))
vi.mock('../src/templates-v2.js', async orig => ({
  ...(await orig<any>()),
  findBySlugWithDefaults: vi.fn(), findBySlug: vi.fn(), liveVersion: vi.fn(),
}))
vi.mock('@jeffi/tenancy', async orig => ({ ...(await orig<any>()), signLink: vi.fn(() => null), MEDIA_CDN_URL: 'https://cdn.jeffi' }))
vi.mock('../src/media.js', () => ({ hostUrl: vi.fn(), MediaError: class extends Error { constructor(public status: number, public code: string, m: string) { super(m) } } }))

import { resolveTemplate, systemVars, SendError } from '../src/send'
import { poolsForTenant } from '../src/pools'
import * as tplv2 from '../src/templates-v2'
import * as gov from '../src/governance'
import { db } from '../src/db'

const PLATFORM = '00000000-0000-0000-0000-000000000000'
const pool = (query = vi.fn(async () => ({ rows: [] }))) => ({ query })

describe('resolveTemplate', () => {
  beforeEach(() => {
    vi.mocked(poolsForTenant).mockReset()
    vi.mocked(tplv2.findBySlugWithDefaults).mockReset()
    vi.mocked(tplv2.findBySlug).mockReset()
    vi.mocked(tplv2.liveVersion).mockReset()
    vi.mocked(gov.getSettings).mockReset().mockResolvedValue({ standard_templates: 'all', allowed: [], editing_enabled: true, review_required: false } as any)
  })

  it('returns null when no template resolves', async () => {
    const p = pool()
    vi.mocked(poolsForTenant).mockResolvedValue({ pools: { tenant: p, platform: p } } as any)
    vi.mocked(tplv2.findBySlugWithDefaults).mockResolvedValue(null as any)
    expect(await resolveTemplate('t1', 'email', 'nope')).toBeNull()
  })

  it('returns the version subject/body for a plain email template', async () => {
    const p = pool()
    vi.mocked(poolsForTenant).mockResolvedValue({ pools: { tenant: p, platform: p } } as any)
    vi.mocked(tplv2.findBySlugWithDefaults).mockResolvedValue({
      family: { tenant_id: 't1', slug: 's' }, template: { channel: 'email' },
      variant: { id: 'v1', provider_ref: null, meta_category: null },
      version: { subject: 'Hi', preheader: 'pre', body: 'Body', blocks: null, layout: 'store' },
    } as any)
    const r = await resolveTemplate('t1', 'email', 's')
    expect(r).toMatchObject({ subject: 'Hi', body: 'Body', preheader: 'pre' })
  })

  it('api space: a disallowed standard template is 404', async () => {
    const p = pool()
    vi.mocked(poolsForTenant).mockResolvedValue({ pools: { tenant: p, platform: p } } as any)
    vi.mocked(gov.getSettings).mockResolvedValue({ standard_templates: 'selected', allowed: [], editing_enabled: true, review_required: false } as any)
    vi.mocked(gov.standardAllowed).mockReturnValueOnce(false)
    vi.mocked(tplv2.findBySlugWithDefaults).mockResolvedValue({
      family: { tenant_id: PLATFORM, slug: 's' }, template: { channel: 'email' },
      variant: { id: 'v1', provider_ref: null }, version: { body: 'b', subject: 'S', preheader: null },
    } as any)
    await expect(resolveTemplate('t1', 'email', 's', 'api')).rejects.toMatchObject({ status: 404, code: 'template_not_available' })
  })

  it('api space: a tenant template pending review with no approved version is 422', async () => {
    const p = pool()
    vi.mocked(poolsForTenant).mockResolvedValue({ pools: { tenant: p, platform: p } } as any)
    vi.mocked(tplv2.findBySlugWithDefaults).mockResolvedValue({
      family: { tenant_id: 't1', slug: 's' }, template: { channel: 'email' },
      variant: { id: 'v1', provider_ref: null, review_status: 'pending', approved_version_id: null },
      version: { body: 'b', subject: 'S', preheader: null },
    } as any)
    await expect(resolveTemplate('t1', 'email', 's', 'api')).rejects.toMatchObject({ status: 422, code: 'template_pending_review' })
  })

  it('api space: pending review falls back to the approved version', async () => {
    const approved = { subject: 'Approved', body: 'old body', preheader: null, blocks: null, layout: 'store' }
    const p = pool(vi.fn(async () => ({ rows: [approved] })))
    vi.mocked(poolsForTenant).mockResolvedValue({ pools: { tenant: p, platform: p } } as any)
    vi.mocked(tplv2.findBySlugWithDefaults).mockResolvedValue({
      family: { tenant_id: 't1', slug: 's' }, template: { channel: 'email' },
      variant: { id: 'v1', provider_ref: null, review_status: 'pending', approved_version_id: 'ver0' },
      version: { subject: 'Draft', body: 'new body', preheader: null, blocks: null, layout: 'store' },
    } as any)
    const r = await resolveTemplate('t1', 'email', 's', 'api')
    expect(r?.body).toBe('old body')
  })

  it('whatsapp: an unapproved tenant copy falls back to the platform approved template', async () => {
    const p = pool()
    vi.mocked(poolsForTenant).mockResolvedValue({ pools: { tenant: p, platform: p } } as any)
    vi.mocked(tplv2.findBySlugWithDefaults).mockResolvedValue({
      family: { tenant_id: 't1', slug: 's' }, template: { channel: 'whatsapp' },
      variant: { id: 'v1', provider_ref: null, meta_category: null },
      version: { body: 'tenant', subject: null, preheader: null, blocks: null, layout: 'store' },
    } as any)
    vi.mocked(tplv2.findBySlug).mockResolvedValue({
      family: { tenant_id: PLATFORM, slug: 's' }, template: { channel: 'whatsapp' },
      variant: { id: 'pv', provider_ref: 'HX1', meta_category: 'UTILITY' },
      version: { body: 'platform approved', subject: null, preheader: null, blocks: null, layout: 'store' },
    } as any)
    vi.mocked(tplv2.liveVersion).mockResolvedValue({ body: 'platform approved', subject: null, preheader: null, blocks: null, layout: 'store' } as any)
    const r = await resolveTemplate('t1', 'whatsapp', 's')
    expect(r?.body).toBe('platform approved')
    expect(r?.provider_ref).toBe('HX1')
  })
})

describe('systemVars', () => {
  beforeEach(() => { vi.mocked(poolsForTenant).mockReset(); vi.mocked(db.query).mockClear(); dbState.tenants.clear() })

  it('builds recipient + store defaults for the platform tenant', async () => {
    const p = pool(vi.fn(async (sql: string) =>
      sql.includes('site_settings') ? { rows: [{ key: 'business_name', value: 'Jeffi' }] }
      : sql.includes('template_variables') ? { rows: [{ key: 'promo', value: 'SALE' }] } : { rows: [] }))
    vi.mocked(poolsForTenant).mockResolvedValue({ pool: p, pools: { tenant: p, platform: p } } as any)
    const v = await systemVars(PLATFORM)
    expect(v.store_name).toBe('Jeffi')
    expect(v.brand_name).toBe('Jeffi')
    expect(v.promo).toBe('SALE')
    expect(v.customer_name).toBe('there')
    expect(v.current_year).toBe(String(new Date().getFullYear()))
  })

  it('derives store_web from the tenant slug when no setting is present', async () => {
    dbState.tenants.set('ten1', { display_name: 'Acme', slug: 'acme' })
    // A tenant with its own store DB (pool !== db) so its site_settings are read.
    const p = pool(vi.fn(async () => ({ rows: [] })))
    vi.mocked(poolsForTenant).mockResolvedValue({ pool: p, pools: { tenant: p, platform: {} } } as any)
    const v = await systemVars('ten1')
    expect(v.store_name).toBe('Acme')
    expect(v.store_web).toBe('acme.jeffistores.in')
  })
})
