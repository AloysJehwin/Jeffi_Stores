import { describe, it, expect } from 'vitest'
import { CRON_JOBS, cronSchedule } from '@/lib/shared/cron-jobs'

describe('Google Ads intelligence cron jobs', () => {
  it('refreshes Customer Match lists daily and sends the digest weekly, per store via the fan-out', () => {
    const lists = CRON_JOBS.find(j => j.id === 'google_ads_audiences')!
    const digest = CRON_JOBS.find(j => j.id === 'google_ads_digest')!
    expect(lists).toMatchObject({ path: '/api/cron/google-ads-audiences', tenantScope: 'google_ads:read' })
    expect(digest).toMatchObject({ path: '/api/cron/google-ads-digest', tenantScope: 'google_ads:read' })
    expect(cronSchedule(lists)).toBe('0 6 * * *')
    expect(cronSchedule(digest)).toBe('0 9 * * 1')
    expect(digest.lockTtlMs).toBeLessThan(digest.intervalMs)
  })
})
