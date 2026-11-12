/**
 * Tests for src/lib/provisioning/trigger.ts — the single entry point every provisioning
 * flow funnels through. Pins the behaviours that matter for the four owner-portal flows:
 *   - provision under the STUB provider drives the job to completion in-request
 *   - provision is idempotent (enqueue reuses an in-flight job)
 *   - reprovision goes to the DNS-only path, never enqueues a job
 *   - deprovision routes to deprovisionTenant
 *   - kickAdvance is a no-op under the stub (jobs run inline)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const reg = {
  getTenant: vi.fn(),
  getProvisioningJob: vi.fn(),
  enqueueProvisioning: vi.fn(),
  updateProvisioningJob: vi.fn().mockResolvedValue(undefined),
  controlPlanePool: vi.fn(),
  getDraft: vi.fn(),
}
vi.mock('@/lib/tenant-registry', () => reg)

const steps = {
  advanceProvisioningJob: vi.fn(),
  deprovisionTenant: vi.fn(),
  reprovisionDns: vi.fn(),
}
vi.mock('@controller/lib/provisioning/steps', () => steps)

const backup = { findLatestBackup: vi.fn() }
vi.mock('@/lib/tenancy/tenant-backup-store', () => backup)

// Provider factory — trigger only forwards the instance to steps.* (all mocked), so a
// bare object is enough.
vi.mock('@controller/lib/provisioning', () => ({ getProvisioningProvider: () => ({}) }))

describe('triggerProvisioning', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.PROVISIONING_PROVIDER // → stub
    reg.updateProvisioningJob.mockResolvedValue(undefined)
  })
  afterEach(() => {
    delete process.env.PROVISIONING_PROVIDER
  })

  it('provision (stub) enqueues then drives the job to done in-request', async () => {
    reg.enqueueProvisioning.mockResolvedValue({ id: 'job-1', status: 'pending', created_resources: {} })
    // First poll returns a running job, second returns done → loop terminates.
    reg.getProvisioningJob
      .mockResolvedValueOnce({ id: 'job-1', status: 'pending', step: 'preflight' })
      .mockResolvedValue({ id: 'job-1', status: 'done', step: 'activate' })
    steps.advanceProvisioningJob.mockResolvedValue('pending')

    const { triggerProvisioning } = await import('@controller/lib/provisioning/trigger')
    const out = await triggerProvisioning({
      action: 'provision',
      tenantId: 't-1',
      slug: 'acme',
      plan: 'basic',
      ownerId: 'o-1',
    })

    expect(reg.enqueueProvisioning).toHaveBeenCalledWith('t-1', undefined)
    expect(steps.advanceProvisioningJob).toHaveBeenCalled()
    expect(out).toMatchObject({ ok: true, jobStatus: 'done' })
  })

  it('provision (stub) keeps driving a long pipeline to done', async () => {
    reg.enqueueProvisioning.mockResolvedValue({ id: 'job-1', status: 'pending', created_resources: {} })
    // A node-database pipeline plus the stub database's polls runs well past 20 ticks.
    for (let i = 0; i < 30; i++) reg.getProvisioningJob.mockResolvedValueOnce({ id: 'job-1', status: 'pending', step: 'load_schema' })
    reg.getProvisioningJob.mockResolvedValue({ id: 'job-1', status: 'done', step: 'activate' })
    steps.advanceProvisioningJob.mockResolvedValue('pending')

    const { triggerProvisioning } = await import('@controller/lib/provisioning/trigger')
    const out = await triggerProvisioning({ action: 'provision', tenantId: 't-1', slug: 'acme', plan: 'basic', ownerId: 'o-1' })

    expect(steps.advanceProvisioningJob).toHaveBeenCalledTimes(30)
    expect(out).toMatchObject({ ok: true, jobStatus: 'done' })
  })

  it('provision passes a restoreFromKey through to enqueue', async () => {
    reg.enqueueProvisioning.mockResolvedValue({ id: 'j', status: 'done', created_resources: {} })
    reg.getProvisioningJob.mockResolvedValue({ id: 'j', status: 'done' })
    const { triggerProvisioning } = await import('@controller/lib/provisioning/trigger')
    await triggerProvisioning({
      action: 'provision',
      tenantId: 't-1',
      slug: 'acme',
      plan: 'basic',
      ownerId: 'o-1',
      restoreFromKey: 'k/1.gz',
    })
    expect(reg.enqueueProvisioning).toHaveBeenCalledWith('t-1', { restoreFromKey: 'k/1.gz' })
  })

  it('reprovision calls the DNS-only path and never enqueues', async () => {
    steps.reprovisionDns.mockResolvedValue({ ok: true, added: ['x'], removed: [] })
    const { triggerProvisioning } = await import('@controller/lib/provisioning/trigger')
    const out = await triggerProvisioning({
      action: 'reprovision',
      tenantId: 't-1',
      slug: 'acme',
      plan: 'growth',
      ownerId: 'o-1',
    })
    expect(steps.reprovisionDns).toHaveBeenCalledWith('t-1', expect.anything())
    expect(reg.enqueueProvisioning).not.toHaveBeenCalled()
    expect(out).toMatchObject({ ok: true, added: ['x'] })
  })

  it('deprovision routes to deprovisionTenant with the ownerId', async () => {
    steps.deprovisionTenant.mockResolvedValue({ ok: true, backupKey: 'k', backedUp: true })
    const { triggerProvisioning } = await import('@controller/lib/provisioning/trigger')
    const out = await triggerProvisioning({
      action: 'deprovision',
      tenantId: 't-1',
      slug: 'acme',
      plan: null,
      ownerId: 'o-1',
    })
    expect(steps.deprovisionTenant).toHaveBeenCalledWith('t-1', expect.anything(), { ownerId: 'o-1' })
    expect(out.ok).toBe(true)
  })

  it('AWS provision drives inline until the job parks on a poll step', async () => {
    process.env.PROVISIONING_PROVIDER = 'aws'
    reg.enqueueProvisioning.mockResolvedValue({ id: 'j', status: 'pending', step: 'preflight', created_resources: {} })
    // Job stays on the SAME step, still pending → the inline loop hands off to the worker.
    reg.getProvisioningJob.mockResolvedValue({ id: 'j', status: 'pending', step: 'wait_db_available' })
    steps.advanceProvisioningJob.mockResolvedValue('pending')
    const { triggerProvisioning } = await import('@controller/lib/provisioning/trigger')
    const out = await triggerProvisioning({
      action: 'provision',
      tenantId: 't-1',
      slug: 'acme',
      plan: 'basic',
      ownerId: 'o-1',
    })
    // AWS now drives inline (bounded) rather than being pure enqueue-only.
    expect(steps.advanceProvisioningJob).toHaveBeenCalled()
    expect(out).toMatchObject({ ok: true, jobStatus: 'pending' })
  })
})

// What a returning owner chose to bring back from the archive a deprovision kept.
const archivesMod = vi.hoisted(() => ({ getOwnerArchive: vi.fn() }))
vi.mock('@/lib/tenant-registry/archives', () => archivesMod)

describe('resolveRestorePlan', () => {
  const ARCHIVE = {
    id: 'arch-1',
    keep_database: true,
    keep_media: true,
    keep_config: false,
    db_backup_key: 'tenant-backups/by-owner/o-1/x.sql.gz',
    media_prefix: 'tenant-backups/media/o-1/acme/STAMP/',
  }
  beforeEach(() => {
    vi.clearAllMocks()
    reg.controlPlanePool.mockReturnValue({ query: vi.fn().mockResolvedValue({ rows: [{ owner_id: 'o-1' }] }) })
  })

  it('restores only what the owner ticked and the archive kept', async () => {
    reg.getDraft.mockResolvedValue({ data: { restore: { archiveId: 'arch-1', database: false, media: true, config: true } } })
    archivesMod.getOwnerArchive.mockResolvedValue(ARCHIVE)
    const { resolveRestorePlan } = await import('@controller/lib/provisioning/trigger')

    // Database: kept but not ticked. Configuration: ticked but not kept.
    expect(await resolveRestorePlan('t-1', 'acme')).toEqual({
      restoreMediaPrefix: 'tenant-backups/media/o-1/acme/STAMP/',
      restoreArchiveId: 'arch-1',
    })
    expect(archivesMod.getOwnerArchive).toHaveBeenCalledWith('o-1', 'arch-1')
  })

  it('restores nothing from an archive that is not this owner’s (or has expired)', async () => {
    reg.getDraft.mockResolvedValue({ data: { restore: { archiveId: 'someone-elses', database: true, media: true, config: true } } })
    archivesMod.getOwnerArchive.mockResolvedValue(null)
    const { resolveRestorePlan, resolveRestoreKey } = await import('@controller/lib/provisioning/trigger')

    expect(await resolveRestorePlan('t-1', 'acme')).toEqual({})
    expect(await resolveRestoreKey('t-1', 'acme')).toBeUndefined()
    expect(backup.findLatestBackup).not.toHaveBeenCalled()
  })

  it('still restores the newest database backup for a draft from before archives', async () => {
    reg.getDraft.mockResolvedValue({ data: { restorePreviousData: true } })
    backup.findLatestBackup.mockResolvedValue({ key: 'tenant-backups/by-owner/o-1/old.sql.gz' })
    const { resolveRestorePlan } = await import('@controller/lib/provisioning/trigger')

    expect(await resolveRestorePlan('t-1', 'acme')).toEqual({ restoreFromKey: 'tenant-backups/by-owner/o-1/old.sql.gz' })
  })

  it('restores nothing when the owner did not ask', async () => {
    reg.getDraft.mockResolvedValue({ data: {} })
    const { resolveRestorePlan } = await import('@controller/lib/provisioning/trigger')
    expect(await resolveRestorePlan('t-1', 'acme')).toEqual({})
  })
})
