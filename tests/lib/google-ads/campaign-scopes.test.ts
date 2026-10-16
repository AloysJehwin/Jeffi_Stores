import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getScopeForPath, hasScope, TENANT_SCOPE_KEYS, ADMIN_SCOPES } from '@/lib/auth/scopes'
import { canUseAi } from '@/lib/auth/ai-scope'
import { COMPARISON_ROWS } from '@/lib/tenant-registry/owners'
import { MANAGE_SCOPE } from '@/lib/google-ads/manage-route'

const seed = readFileSync(join(__dirname, '../../../database/control-plane/seed-plans.sql'), 'utf8')
const matrix = readFileSync(join(__dirname, '../../../docs/PLAN_FEATURE_MATRIX.md'), 'utf8')

describe('google_ads_campaigns:write (campaign management)', () => {
  it('is a tenant scope in the Marketing group', () => {
    expect(MANAGE_SCOPE).toBe('google_ads_campaigns:write')
    expect(TENANT_SCOPE_KEYS).toContain(MANAGE_SCOPE)
    expect(ADMIN_SCOPES.find(s => s.key === MANAGE_SCOPE)).toMatchObject({ group: 'Marketing', routes: ['/admin/google-ads'] })
  })

  it('sells on Pro and Enterprise in both seed blocks, never Basic or Growth', () => {
    for (const plan of ['pro', 'enterprise']) {
      const hits = seed.match(new RegExp(`\\('${plan}', '${MANAGE_SCOPE}'\\)`, 'g')) ?? []
      expect(hits.length, plan).toBe(2)
    }
    expect(seed).not.toMatch(/\('(basic|growth)', 'google_ads_campaigns:write'\)/)
    // reporting stays on Growth and up
    expect(seed).toMatch(/\('growth', 'google_ads:read'\)/)
  })

  it('is not implied by reporting write access', () => {
    expect(hasScope('manager', ['google_ads:write', 'google_ads:read'], MANAGE_SCOPE)).toBe(false)
    expect(hasScope('manager', [MANAGE_SCOPE], MANAGE_SCOPE)).toBe(true)
  })

  it('keeps the console pages and APIs on the reporting scope at the middleware', () => {
    expect(getScopeForPath('/admin/google-ads')).toBe('google_ads:read')
    expect(getScopeForPath('/api/admin/google-ads/manage/campaigns')).toBe('google_ads:read')
  })

  it('gates "Write with AI" on the AI plan feature as well', () => {
    expect(canUseAi('manager', [MANAGE_SCOPE], MANAGE_SCOPE)).toBe(false)
    expect(canUseAi('manager', [MANAGE_SCOPE, 'catalog_enrichment:write'], MANAGE_SCOPE)).toBe(true)
  })

  it('shows in the plan comparison and the feature matrix', () => {
    expect(COMPARISON_ROWS.some(r => r.scopeKey === MANAGE_SCOPE)).toBe(true)
    expect(matrix).toMatch(/`google_ads_campaigns:write` \| ❌ \| ❌ \| ✅ \| ✅/)
  })
})
