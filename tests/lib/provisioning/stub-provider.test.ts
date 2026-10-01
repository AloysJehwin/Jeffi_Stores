/**
 * Tests for src/lib/provisioning/stub-provider.ts
 *
 * The stub is what lets the whole provisioning state machine run with zero real
 * AWS, so its behaviour IS the contract the real AwsProvisioningProvider has to
 * match. Two properties matter most and are asserted explicitly here:
 *
 *   1. IDEMPOTENCE — every method must be safe to re-run, because the worker
 *      re-executes a step after a crash or a retry-with-backoff.
 *   2. The getDbEndpoint POLL — it must return null while "provisioning" and an
 *      endpoint only after N polls. That polling shape is what the real RDS
 *      ~9-minute wait looks like to steps.ts, and it is what `wait_db_available`
 *      loops on.
 */
import { describe, it, expect } from 'vitest'
import { StubProvisioningProvider } from '@/lib/provisioning/stub-provider'

const ARGS = { dbInstanceId: 'jeffi-tenant-acme', paramGroup: 'jeffi-tenant-acme-pg16', maxConnections: 45 }

describe('StubProvisioningProvider', () => {
  describe('parameter groups', () => {
    it('creates a param group and reports it present', async () => {
      const p = new StubProvisioningProvider()
      await p.ensureParamGroup('pg-1', 45)
      expect(p.hasParamGroup('pg-1')).toBe(true)
    })

    it('is idempotent — re-ensuring the same group does not throw', async () => {
      const p = new StubProvisioningProvider()
      await p.ensureParamGroup('pg-1', 45)
      await expect(p.ensureParamGroup('pg-1', 45)).resolves.toBeUndefined()
      expect(p.hasParamGroup('pg-1')).toBe(true)
    })

    it('deletes a param group (and delete is idempotent)', async () => {
      const p = new StubProvisioningProvider()
      await p.ensureParamGroup('pg-1', 45)
      await p.deleteParamGroup('pg-1')
      expect(p.hasParamGroup('pg-1')).toBe(false)
      await expect(p.deleteParamGroup('pg-1')).resolves.toBeUndefined()
    })
  })

  describe('createDbInstance + getDbEndpoint polling', () => {
    it('returns null while still provisioning, then the endpoint once ready', async () => {
      const p = new StubProvisioningProvider(2) // available after 2 polls
      await p.createDbInstance(ARGS)

      expect(await p.getDbEndpoint(ARGS.dbInstanceId)).toBeNull() // poll 1
      expect(await p.getDbEndpoint(ARGS.dbInstanceId)).toBeNull() // poll 2
      const ep = await p.getDbEndpoint(ARGS.dbInstanceId) // now available
      expect(ep).toBe('jeffi-tenant-acme.stub.us-east-1.rds.amazonaws.com')
    })

    it('keeps returning the SAME endpoint once available (stable across polls)', async () => {
      const p = new StubProvisioningProvider(0)
      await p.createDbInstance(ARGS)
      const first = await p.getDbEndpoint(ARGS.dbInstanceId)
      const second = await p.getDbEndpoint(ARGS.dbInstanceId)
      expect(first).toBe(second)
      expect(first).not.toBeNull()
    })

    it('is available immediately when constructed with 0 polls', async () => {
      const p = new StubProvisioningProvider(0)
      await p.createDbInstance(ARGS)
      expect(await p.getDbEndpoint(ARGS.dbInstanceId)).not.toBeNull()
    })

    it('returns null for an instance that was never created', async () => {
      const p = new StubProvisioningProvider()
      expect(await p.getDbEndpoint('never-made')).toBeNull()
    })

    it('echoes back the instance id', async () => {
      const p = new StubProvisioningProvider()
      await expect(p.createDbInstance(ARGS)).resolves.toEqual({ dbInstanceId: ARGS.dbInstanceId })
    })

    it('does NOT restart the countdown when re-created (idempotent retry)', async () => {
      const p = new StubProvisioningProvider(1)
      await p.createDbInstance(ARGS)
      expect(await p.getDbEndpoint(ARGS.dbInstanceId)).toBeNull() // burns the 1 pending poll
      await p.createDbInstance(ARGS) // retry must not reset it
      expect(await p.getDbEndpoint(ARGS.dbInstanceId)).not.toBeNull()
    })
  })

  describe('schema + backup/restore', () => {
    it('loadSchema is a no-op that resolves', async () => {
      const p = new StubProvisioningProvider()
      await expect(p.loadSchema('ep', 'jeffi_stores')).resolves.toBeUndefined()
    })

    it('backupDb returns real bytes and records the backup', async () => {
      const p = new StubProvisioningProvider()
      const buf = await p.backupDb('ep-1', 'jeffi_stores')
      expect(Buffer.isBuffer(buf)).toBe(true)
      expect(buf.length).toBeGreaterThan(0)
      expect(JSON.parse(buf.toString('utf8'))).toEqual({ stub: true, endpoint: 'ep-1' })
      expect(p.wasBackedUp('ep-1')).toBe(true)
    })

    it('backup output is deterministic for the same endpoint', async () => {
      const p = new StubProvisioningProvider()
      const a = await p.backupDb('ep-1', 'db')
      const b = await p.backupDb('ep-1', 'db')
      expect(a.equals(b)).toBe(true)
    })

    it('restoreDb records the archive it was handed (round-trip)', async () => {
      const p = new StubProvisioningProvider()
      const archive = await p.backupDb('ep-1', 'db')
      await p.restoreDb('ep-2', 'db', archive)
      expect(p.wasRestored('ep-2')).toBe(true)
      expect(p.wasRestored('ep-1')).toBe(false)
    })
  })

  describe('buckets', () => {
    it('creates a bucket, idempotently', async () => {
      const p = new StubProvisioningProvider()
      await p.ensureBucket('jeffi-tenant-acme')
      await p.ensureBucket('jeffi-tenant-acme')
      expect(p.hasBucket('jeffi-tenant-acme')).toBe(true)
    })

    it('deletes a bucket, idempotently', async () => {
      const p = new StubProvisioningProvider()
      await p.ensureBucket('b')
      await p.deleteBucket('b')
      expect(p.hasBucket('b')).toBe(false)
      await expect(p.deleteBucket('b')).resolves.toBeUndefined()
    })
  })

  describe('DNS', () => {
    it('adds every hostname it is given', async () => {
      const p = new StubProvisioningProvider()
      await p.ensureDns(['acme.jeffistores.in', 'admin-acme.jeffistores.in'])
      expect(p.hasDns('acme.jeffistores.in')).toBe(true)
      expect(p.hasDns('admin-acme.jeffistores.in')).toBe(true)
    })

    it('removes hostnames on teardown, leaving others intact', async () => {
      const p = new StubProvisioningProvider()
      await p.ensureDns(['a.jeffistores.in', 'b.jeffistores.in'])
      await p.removeDns(['a.jeffistores.in'])
      expect(p.hasDns('a.jeffistores.in')).toBe(false)
      expect(p.hasDns('b.jeffistores.in')).toBe(true)
    })

    it('ensure/remove are idempotent and tolerate unknown hosts', async () => {
      const p = new StubProvisioningProvider()
      await p.ensureDns(['a.jeffistores.in'])
      await p.ensureDns(['a.jeffistores.in'])
      await expect(p.removeDns(['never-added.jeffistores.in'])).resolves.toBeUndefined()
      expect(p.hasDns('a.jeffistores.in')).toBe(true)
    })

    it('handles an empty hostname list', async () => {
      const p = new StubProvisioningProvider()
      await expect(p.ensureDns([])).resolves.toBeUndefined()
      await expect(p.removeDns([])).resolves.toBeUndefined()
    })
  })

  describe('stop/start (test-tenant cost saving)', () => {
    it('stops and restarts an instance', async () => {
      const p = new StubProvisioningProvider()
      await p.stopDbInstance('db-1')
      expect(p.isStopped('db-1')).toBe(true)
      await p.startDbInstance('db-1')
      expect(p.isStopped('db-1')).toBe(false)
    })

    it('is idempotent in both directions', async () => {
      const p = new StubProvisioningProvider()
      await p.stopDbInstance('db-1')
      await p.stopDbInstance('db-1')
      expect(p.isStopped('db-1')).toBe(true)
      await p.startDbInstance('db-1')
      await p.startDbInstance('db-1')
      expect(p.isStopped('db-1')).toBe(false)
    })
  })

  describe('teardown ordering — isDbInstanceGone', () => {
    it('reports gone for an instance that never existed', async () => {
      const p = new StubProvisioningProvider()
      expect(await p.isDbInstanceGone('nope')).toBe(true)
    })

    it('reports NOT gone while still provisioning', async () => {
      const p = new StubProvisioningProvider(5)
      await p.createDbInstance(ARGS)
      expect(await p.isDbInstanceGone(ARGS.dbInstanceId)).toBe(false)
    })

    it('reports NOT gone once available', async () => {
      const p = new StubProvisioningProvider(0)
      await p.createDbInstance(ARGS)
      await p.getDbEndpoint(ARGS.dbInstanceId)
      expect(await p.isDbInstanceGone(ARGS.dbInstanceId)).toBe(false)
    })

    it('reports gone after delete — the gate param-group teardown waits on', async () => {
      const p = new StubProvisioningProvider(0)
      await p.createDbInstance(ARGS)
      await p.getDbEndpoint(ARGS.dbInstanceId)
      await p.deleteDbInstance(ARGS.dbInstanceId)
      expect(await p.isDbInstanceGone(ARGS.dbInstanceId)).toBe(true)
    })

    it('delete clears pending, endpoint and stopped state together', async () => {
      const p = new StubProvisioningProvider(0)
      await p.createDbInstance(ARGS)
      await p.getDbEndpoint(ARGS.dbInstanceId)
      await p.stopDbInstance(ARGS.dbInstanceId)
      await p.deleteDbInstance(ARGS.dbInstanceId)
      expect(p.isStopped(ARGS.dbInstanceId)).toBe(false)
      expect(await p.getDbEndpoint(ARGS.dbInstanceId)).toBeNull()
    })

    it('delete is idempotent', async () => {
      const p = new StubProvisioningProvider()
      await p.createDbInstance(ARGS)
      await p.deleteDbInstance(ARGS.dbInstanceId)
      await expect(p.deleteDbInstance(ARGS.dbInstanceId)).resolves.toBeUndefined()
    })
  })

  describe('isolation between tenants', () => {
    it('keeps separate instances independent', async () => {
      const p = new StubProvisioningProvider(0)
      await p.createDbInstance({ ...ARGS, dbInstanceId: 'tenant-a' })
      await p.createDbInstance({ ...ARGS, dbInstanceId: 'tenant-b' })
      await p.getDbEndpoint('tenant-a')
      await p.getDbEndpoint('tenant-b')

      await p.deleteDbInstance('tenant-a')

      expect(await p.isDbInstanceGone('tenant-a')).toBe(true)
      expect(await p.isDbInstanceGone('tenant-b')).toBe(false)
    })
  })
})
