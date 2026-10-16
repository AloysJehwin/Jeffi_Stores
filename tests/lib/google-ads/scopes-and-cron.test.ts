import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getScopeForPath, hasScope, TENANT_SCOPE_KEYS } from '@/lib/auth/scopes'
import { CRON_JOBS, cronSchedule } from '@/lib/shared/cron-jobs'
import { COMPARISON_ROWS } from '@/lib/tenant-registry/owners'

const seed = readFileSync(join(__dirname, '../../../database/control-plane/seed-plans.sql'), 'utf8')

describe('google_ads scopes', () => {
  it('maps the console and its APIs to google_ads:read', () => {
    expect(getScopeForPath('/admin/google-ads')).toBe('google_ads:read')
    expect(getScopeForPath('/admin/google-ads/anything')).toBe('google_ads:read')
    expect(getScopeForPath('/api/admin/google-ads/report')).toBe('google_ads:read')
    expect(getScopeForPath('/api/admin/integrations/google-ads/connect')).toBe('google_ads:read')
  })

  it('is a tenant scope where write implies read', () => {
    expect(TENANT_SCOPE_KEYS).toEqual(expect.arrayContaining(['google_ads:read', 'google_ads:write']))
    expect(hasScope('manager', ['google_ads:write'], 'google_ads:read')).toBe(true)
    expect(hasScope('manager', ['traffic:read'], 'google_ads:read')).toBe(false)
  })

  it('sells on Growth and up in both seed blocks, never Basic', () => {
    for (const plan of ['growth', 'pro', 'enterprise']) {
      for (const scope of ['google_ads:read', 'google_ads:write']) {
        const hits = seed.match(new RegExp(`\\('${plan}', '${scope}'\\)`, 'g')) ?? []
        expect(hits.length, `${plan} ${scope}`).toBe(2)
      }
    }
    expect(seed).not.toMatch(/\('basic', 'google_ads:/)
  })

  it('appears in the plan comparison', () => {
    expect(COMPARISON_ROWS.some(r => r.scopeKey === 'google_ads:read')).toBe(true)
  })
})

describe('google ads cron jobs', () => {
  it('fans out per store on google_ads:read', () => {
    const nightly = CRON_JOBS.find(j => j.id === 'google_ads_sync')!
    const intraday = CRON_JOBS.find(j => j.id === 'google_ads_refresh')!
    expect(nightly).toMatchObject({ path: '/api/cron/google-ads-sync', tenantScope: 'google_ads:read' })
    expect(intraday).toMatchObject({ path: '/api/cron/google-ads-refresh', tenantScope: 'google_ads:read' })
    expect(cronSchedule(nightly)).toBe('30 4 * * *')
    expect(cronSchedule(intraday)).toBe('5 */3 * * *')
  })
})
