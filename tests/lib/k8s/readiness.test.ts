import { describe, it, expect } from 'vitest'
import {
  traefikCertToPem,
  parseTraefikCertInfo,
  clientCertFromProxy,
  TRAEFIK_CERT_HEADER,
  TRAEFIK_CERT_INFO_HEADER,
} from '@/lib/tenancy/edge-client-cert'
import { CRON_JOBS, cronSchedule, inProcessCronEnabled } from '@/lib/shared/cron-jobs'
import { computeTierFor, COMPUTE_TIERS } from '@/lib/provisioning/tiers'

const B64 = 'MIIB' + 'A'.repeat(130) + '=='

describe('traefik client cert adapter', () => {
  it('rebuilds a PEM from the url-escaped leaf, ignoring the chain', () => {
    const pem = traefikCertToPem(encodeURIComponent(`${B64},MIICchain`))!
    expect(pem.startsWith('-----BEGIN CERTIFICATE-----\nMIIB')).toBe(true)
    expect(pem.split('\n').every(l => l.length <= 64)).toBe(true)
    expect(pem).not.toContain('chain')
  })

  it('rejects junk', () => {
    expect(traefikCertToPem('%E0%A4%A')).toBeNull()
    expect(traefikCertToPem('<script>')).toBeNull()
    expect(traefikCertToPem('')).toBeNull()
  })

  it('parses the leaf CN and converts the decimal serial to hex', () => {
    const info = encodeURIComponent('Subject="CN=alice,O=Acme";Issuer="CN=CA";SerialNumber="255";NB="1";NA="2",Subject="CN=ca"')
    expect(parseTraefikCertInfo(info)).toEqual({ serial: 'FF', commonName: 'alice' })
    expect(parseTraefikCertInfo(encodeURIComponent('SerialNumber="4096"')).serial).toBe('1000')
  })

  it('only trusts traefik headers when traefik is the configured proxy', () => {
    const h = new Headers({
      [TRAEFIK_CERT_INFO_HEADER]: encodeURIComponent('Subject="CN=mallory";SerialNumber="1"'),
      'x-client-cert-serial': 'ABCD',
    })
    expect(clientCertFromProxy(h, 'nginx')).toMatchObject({ serial: 'ABCD', commonName: null })
    expect(clientCertFromProxy(h, 'traefik')).toMatchObject({ serial: '01', commonName: 'mallory' })
    expect(clientCertFromProxy(new Headers({ [TRAEFIK_CERT_HEADER]: B64 }), 'traefik').pem).toContain('BEGIN CERTIFICATE')
  })
})

describe('cron scheduling for k8s', () => {
  it('honours the IN_PROCESS_CRON kill switch', () => {
    expect(inProcessCronEnabled({})).toBe(true)
    expect(inProcessCronEnabled({ IN_PROCESS_CRON: 'false' })).toBe(false)
  })

  it('maps every job to a valid 5-field schedule', () => {
    for (const job of CRON_JOBS) expect(cronSchedule(job).split(' ')).toHaveLength(5)
    const by = Object.fromEntries(CRON_JOBS.map(j => [j.id, cronSchedule(j)]))
    expect(by.cancel_stale_orders).toBe('* * * * *')
    expect(by.provisioning_worker).toBe('* * * * *')
    expect(by.delhivery_sync).toBe('*/10 * * * *')
    expect(by.daily_briefing).toBe('0 8 * * *')
    expect(by.provisioning_reconcile).toMatch(/^\d+ \* \* \* \*$/)
  })
})

describe('compute tiers', () => {
  it('places basic on the pool and paid tiers on dedicated nodes', () => {
    expect(computeTierFor('basic').placement).toBe('pool')
    for (const p of ['growth', 'pro', 'enterprise'] as const) expect(COMPUTE_TIERS[p].placement).toBe('dedicated')
    expect(computeTierFor('unknown')).toBe(COMPUTE_TIERS.basic)
  })
})

describe('generated k8s CronJobs', () => {
  it('match the CRON_JOBS registry (run: npx jiti deploy/k8s/gen-cronjobs.ts)', async () => {
    const { readFileSync } = await import('node:fs')
    const { renderCronJobs, CRONJOBS_PATH } = await import('../../../deploy/k8s/gen-cronjobs')
    expect(readFileSync(CRONJOBS_PATH, 'utf8')).toBe(renderCronJobs())
    for (const job of CRON_JOBS) expect(renderCronJobs()).toContain(`deploy/k8s-cron.mjs, ${job.id}, ${job.method}`)
  })
})
