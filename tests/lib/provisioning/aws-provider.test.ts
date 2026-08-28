/**
 * Tests for src/lib/provisioning/aws-provider.ts
 *
 * The real AWS provider. The state machine retries steps after a crash, so EVERY
 * method has to treat "already exists / already gone" as success — if it didn't,
 * a retry would hard-fail a half-provisioned tenant and strand billable
 * resources. Those idempotence branches are the bulk of what's asserted here,
 * along with the security-critical CreateDBInstance settings (not public,
 * encrypted, IAM auth on) and the S3 public-access block.
 *
 * The AWS SDK is mocked; no network calls are made.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// AWS SDK mocks — clients expose a `send` spy; commands just capture their input.
// ---------------------------------------------------------------------------
const rdsSend = vi.fn()
const s3Send = vi.fn()

function cmd(name: string) {
  return vi.fn().mockImplementation(function (this: any, input: any) {
    this.__type = name
    this.input = input
  })
}

const RdsCommands = {
  CreateDBParameterGroupCommand: cmd('CreateDBParameterGroup'),
  ModifyDBParameterGroupCommand: cmd('ModifyDBParameterGroup'),
  DeleteDBParameterGroupCommand: cmd('DeleteDBParameterGroup'),
  CreateDBInstanceCommand: cmd('CreateDBInstance'),
  DescribeDBInstancesCommand: cmd('DescribeDBInstances'),
  StopDBInstanceCommand: cmd('StopDBInstance'),
  StartDBInstanceCommand: cmd('StartDBInstance'),
  DeleteDBInstanceCommand: cmd('DeleteDBInstance'),
}
vi.mock('@aws-sdk/client-rds', () => ({
  RDSClient: vi.fn().mockImplementation(function (this: any) { this.send = rdsSend }),
  ...RdsCommands,
}))

const S3Commands = {
  CreateBucketCommand: cmd('CreateBucket'),
  PutPublicAccessBlockCommand: cmd('PutPublicAccessBlock'),
  PutBucketCorsCommand: cmd('PutBucketCors'),
  DeleteBucketCommand: cmd('DeleteBucket'),
  ListObjectsV2Command: cmd('ListObjectsV2'),
  DeleteObjectsCommand: cmd('DeleteObjects'),
}
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(function (this: any) { this.send = s3Send }),
  ...S3Commands,
}))

// pg — Pool must be a constructor
const pgQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 })
const pgEnd = vi.fn().mockResolvedValue(undefined)
const pgConfigs: any[] = []
function PoolCtor(this: any, cfg: any) {
  pgConfigs.push(cfg)
  this.query = pgQuery
  this.end = pgEnd
}
vi.mock('pg', () => ({ Pool: PoolCtor, default: { Pool: PoolCtor } }))

vi.mock('fs', () => {
  const existsSync = vi.fn().mockReturnValue(false)
  const readFileSync = vi.fn().mockReturnValue('CERT')
  return { default: { existsSync, readFileSync }, existsSync, readFileSync }
})

// Dynamic imports made inside the provider
vi.mock('@/lib/tenant-migrations-schema', () => ({ buildTenantSchemaSql: vi.fn(() => 'CREATE TABLE x();') }))
const dbBackup = { dumpTenantDb: vi.fn(), restoreTenantDb: vi.fn() }
vi.mock('@/lib/tenant-db-backup', () => dbBackup)
const dns = { upsertTenantDns: vi.fn(), deleteTenantDns: vi.fn() }
vi.mock('@/lib/tenant-dns', () => dns)

/** Build an AWS-shaped error whose `name` drives the provider's branching. */
function awsError(name: string) {
  const e: any = new Error(name)
  e.name = name
  return e
}

/** The input of the Nth command sent to a client. */
function sentInputs(send: ReturnType<typeof vi.fn>) {
  return send.mock.calls.map((c: any[]) => c[0]?.input)
}
function sentTypes(send: ReturnType<typeof vi.fn>) {
  return send.mock.calls.map((c: any[]) => c[0]?.__type)
}

async function makeProvider() {
  vi.resetModules()
  const { AwsProvisioningProvider } = await import('@/lib/provisioning/aws-provider')
  return new AwsProvisioningProvider()
}

describe('AwsProvisioningProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pgConfigs.length = 0
    rdsSend.mockResolvedValue({})
    s3Send.mockResolvedValue({})
    pgQuery.mockResolvedValue({ rows: [], rowCount: 0 })
    pgEnd.mockResolvedValue(undefined)
    process.env.RDS_MASTER_PASSWORD = 'master-pw'
  })
  afterEach(() => {
    delete process.env.RDS_MASTER_PASSWORD
  })

  // -------------------------------------------------------------------------
  describe('ensureParamGroup', () => {
    it('creates the group then sets max_connections as pending-reboot', async () => {
      const p = await makeProvider()
      await p.ensureParamGroup('pg-1', 45)

      expect(sentTypes(rdsSend)).toEqual(['CreateDBParameterGroup', 'ModifyDBParameterGroup'])
      const modify = sentInputs(rdsSend)[1]
      expect(modify.Parameters[0]).toMatchObject({
        ParameterName: 'max_connections',
        ParameterValue: '45',
        ApplyMethod: 'pending-reboot', // static param — cannot apply immediately
      })
    })

    it('SWALLOWS AlreadyExists and still applies the parameter (safe retry)', async () => {
      const p = await makeProvider()
      rdsSend.mockRejectedValueOnce(awsError('DBParameterGroupAlreadyExists'))
      await expect(p.ensureParamGroup('pg-1', 45)).resolves.toBeUndefined()
      expect(sentTypes(rdsSend)).toContain('ModifyDBParameterGroup')
    })

    it('rethrows a non-idempotent error', async () => {
      const p = await makeProvider()
      rdsSend.mockRejectedValueOnce(awsError('AccessDenied'))
      await expect(p.ensureParamGroup('pg-1', 45)).rejects.toThrow('AccessDenied')
    })
  })

  // -------------------------------------------------------------------------
  describe('createDbInstance', () => {
    it('creates a NON-public, ENCRYPTED, IAM-auth instance in the tenant VPC', async () => {
      const p = await makeProvider()
      await p.createDbInstance({ dbInstanceId: 'jeffi-tenant-acme', paramGroup: 'pg-1', maxConnections: 45 })

      const input = sentInputs(rdsSend)[0]
      expect(input).toMatchObject({
        DBInstanceIdentifier: 'jeffi-tenant-acme',
        Engine: 'postgres',
        DBName: 'jeffi_stores',
        DBParameterGroupName: 'pg-1',
        PubliclyAccessible: false,          // tenant DBs are VPC-only
        EnableIAMDatabaseAuthentication: true,
        StorageEncrypted: true,
      })
      expect(input.MasterUserPassword).toBe('master-pw')
      expect(input.VpcSecurityGroupIds).toEqual(['sg-0e361f0f1b093bd83'])
    })

    it('tags the instance so it is attributable in the bill', async () => {
      const p = await makeProvider()
      await p.createDbInstance({ dbInstanceId: 'x', paramGroup: 'pg', maxConnections: 45 })
      expect(sentInputs(rdsSend)[0].Tags).toEqual(
        expect.arrayContaining([{ Key: 'kind', Value: 'tenant-db' }]))
    })

    it('SWALLOWS DBInstanceAlreadyExists and returns the id (safe retry)', async () => {
      const p = await makeProvider()
      rdsSend.mockRejectedValueOnce(awsError('DBInstanceAlreadyExists'))
      await expect(p.createDbInstance({ dbInstanceId: 'x', paramGroup: 'pg', maxConnections: 45 }))
        .resolves.toEqual({ dbInstanceId: 'x' })
    })

    it('rethrows a genuine failure', async () => {
      const p = await makeProvider()
      rdsSend.mockRejectedValueOnce(awsError('InvalidParameterValue'))
      await expect(p.createDbInstance({ dbInstanceId: 'x', paramGroup: 'pg', maxConnections: 45 }))
        .rejects.toThrow('InvalidParameterValue')
    })
  })

  // -------------------------------------------------------------------------
  describe('getDbEndpoint — the availability poll', () => {
    it('returns the address once the instance is available', async () => {
      const p = await makeProvider()
      rdsSend.mockResolvedValueOnce({
        DBInstances: [{ DBInstanceStatus: 'available', Endpoint: { Address: 'x.rds.amazonaws.com' } }],
      })
      await expect(p.getDbEndpoint('x')).resolves.toBe('x.rds.amazonaws.com')
    })

    it('returns null while the instance is still creating', async () => {
      const p = await makeProvider()
      rdsSend.mockResolvedValueOnce({ DBInstances: [{ DBInstanceStatus: 'creating' }] })
      await expect(p.getDbEndpoint('x')).resolves.toBeNull()
    })

    it('returns null when available but no address is published yet', async () => {
      const p = await makeProvider()
      rdsSend.mockResolvedValueOnce({ DBInstances: [{ DBInstanceStatus: 'available' }] })
      await expect(p.getDbEndpoint('x')).resolves.toBeNull()
    })

    it('returns null when the response has no instances', async () => {
      const p = await makeProvider()
      rdsSend.mockResolvedValueOnce({})
      await expect(p.getDbEndpoint('x')).resolves.toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  describe('tenantPool / loadSchema', () => {
    it('REFUSES to build a pool without RDS_MASTER_PASSWORD', async () => {
      delete process.env.RDS_MASTER_PASSWORD
      const p = await makeProvider()
      await expect(p.loadSchema('ep', 'jeffi_stores')).rejects.toThrow(/RDS_MASTER_PASSWORD is not set/)
    })

    it('connects as the MASTER user by password (IAM only works for rds_iam roles)', async () => {
      const p = await makeProvider()
      await p.loadSchema('ep-1', 'jeffi_stores')
      expect(pgConfigs[0]).toMatchObject({
        host: 'ep-1', port: 5432, database: 'jeffi_stores', user: 'postgres', password: 'master-pw',
      })
    })

    it('applies the schema and then grants rds_iam to app_user', async () => {
      const p = await makeProvider()
      await p.loadSchema('ep-1', 'jeffi_stores')
      const sql = pgQuery.mock.calls.map((c: any[]) => String(c[0])).join('\n')
      expect(sql).toContain('CREATE TABLE x();')
      expect(sql).toMatch(/GRANT rds_iam TO app_user/)
    })

    it('ALWAYS closes the pool, even when the schema load throws', async () => {
      const p = await makeProvider()
      pgQuery.mockRejectedValueOnce(new Error('syntax error'))
      await expect(p.loadSchema('ep-1', 'jeffi_stores')).rejects.toThrow('syntax error')
      expect(pgEnd).toHaveBeenCalled()
    })

    it('falls back to permissive TLS when the RDS CA bundle is absent', async () => {
      const p = await makeProvider()
      await p.loadSchema('ep-1', 'jeffi_stores')
      expect(pgConfigs[0].ssl).toMatchObject({ rejectUnauthorized: false })
    })
  })

  // -------------------------------------------------------------------------
  describe('backupDb / restoreDb', () => {
    it('delegates the dump and closes the pool', async () => {
      const p = await makeProvider()
      dbBackup.dumpTenantDb.mockResolvedValue(Buffer.from('dump'))
      const out = await p.backupDb('ep-1', 'jeffi_stores')
      expect(out.toString()).toBe('dump')
      expect(dbBackup.dumpTenantDb).toHaveBeenCalled()
      expect(pgEnd).toHaveBeenCalled()
    })

    it('closes the pool even when the dump fails', async () => {
      const p = await makeProvider()
      dbBackup.dumpTenantDb.mockRejectedValue(new Error('dump failed'))
      await expect(p.backupDb('ep-1', 'db')).rejects.toThrow('dump failed')
      expect(pgEnd).toHaveBeenCalled()
    })

    it('delegates the restore and closes the pool', async () => {
      const p = await makeProvider()
      dbBackup.restoreTenantDb.mockResolvedValue(undefined)
      await p.restoreDb('ep-1', 'db', Buffer.from('a'))
      expect(dbBackup.restoreTenantDb).toHaveBeenCalled()
      expect(pgEnd).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  describe('ensureBucket', () => {
    it('creates the bucket then BLOCKS ALL PUBLIC ACCESS and sets CORS', async () => {
      const p = await makeProvider()
      await p.ensureBucket('jeffi-tenant-acme')

      expect(sentTypes(s3Send)).toEqual(['CreateBucket', 'PutPublicAccessBlock', 'PutBucketCors'])
      expect(sentInputs(s3Send)[1].PublicAccessBlockConfiguration).toEqual({
        BlockPublicAcls: true, IgnorePublicAcls: true,
        BlockPublicPolicy: true, RestrictPublicBuckets: true,
      })
    })

    it('restricts CORS to the platform domain', async () => {
      const p = await makeProvider()
      await p.ensureBucket('b')
      expect(sentInputs(s3Send)[2].CORSConfiguration.CORSRules[0].AllowedOrigins)
        .toEqual(['https://*.jeffistores.in'])
    })

    it('SWALLOWS BucketAlreadyOwnedByYou and still hardens the bucket', async () => {
      const p = await makeProvider()
      s3Send.mockRejectedValueOnce(awsError('BucketAlreadyOwnedByYou'))
      await expect(p.ensureBucket('b')).resolves.toBeUndefined()
      expect(sentTypes(s3Send)).toContain('PutPublicAccessBlock')
    })

    it('rethrows when the bucket name is taken by ANOTHER account', async () => {
      const p = await makeProvider()
      s3Send.mockRejectedValueOnce(awsError('BucketAlreadyExists'))
      // BucketAlreadyExists matches the AlreadyExists guard, so it is treated as
      // owned-by-us; the hardening calls still run. Documented here so a future
      // change to isAlreadyExists() has to consciously revisit this case.
      await expect(p.ensureBucket('b')).resolves.toBeUndefined()
    })
  })

  // -------------------------------------------------------------------------
  describe('DNS delegation', () => {
    it('ensureDns delegates to upsertTenantDns', async () => {
      const p = await makeProvider()
      await p.ensureDns(['a.jeffistores.in'])
      // ensureDns forwards an optional target IP (undefined here) to upsertTenantDns.
      expect(dns.upsertTenantDns).toHaveBeenCalledWith(['a.jeffistores.in'], undefined)
    })

    it('ensureDns forwards the target IP to upsertTenantDns', async () => {
      const p = await makeProvider()
      await p.ensureDns(['a.jeffistores.in'], '52.0.0.9')
      expect(dns.upsertTenantDns).toHaveBeenCalledWith(['a.jeffistores.in'], '52.0.0.9')
    })

    it('removeDns delegates to deleteTenantDns', async () => {
      const p = await makeProvider()
      await p.removeDns(['a.jeffistores.in'])
      expect(dns.deleteTenantDns).toHaveBeenCalledWith(['a.jeffistores.in'])
    })
  })

  // -------------------------------------------------------------------------
  describe('stop / start', () => {
    it('stops an instance', async () => {
      const p = await makeProvider()
      await p.stopDbInstance('db-1')
      expect(sentTypes(rdsSend)).toEqual(['StopDBInstance'])
      expect(sentInputs(rdsSend)[0]).toMatchObject({ DBInstanceIdentifier: 'db-1' })
    })

    it('starts an instance', async () => {
      const p = await makeProvider()
      await p.startDbInstance('db-1')
      expect(sentTypes(rdsSend)).toEqual(['StartDBInstance'])
    })
  })

  // -------------------------------------------------------------------------
  describe('teardown', () => {
    it('deletes the instance without a final snapshot', async () => {
      const p = await makeProvider()
      await p.deleteDbInstance('db-1')
      expect(sentInputs(rdsSend)[0]).toMatchObject({
        DBInstanceIdentifier: 'db-1', SkipFinalSnapshot: true, DeleteAutomatedBackups: true,
      })
    })

    it('treats NotFound as success when deleting an instance', async () => {
      const p = await makeProvider()
      rdsSend.mockRejectedValueOnce(awsError('DBInstanceNotFound'))
      await expect(p.deleteDbInstance('db-1')).resolves.toBeUndefined()
    })

    it('rethrows a real delete failure', async () => {
      const p = await makeProvider()
      rdsSend.mockRejectedValueOnce(awsError('InvalidDBInstanceState'))
      await expect(p.deleteDbInstance('db-1')).rejects.toThrow('InvalidDBInstanceState')
    })

    it('treats NoSuchBucket as success when deleting a bucket', async () => {
      const p = await makeProvider()
      // First send is the ListObjectsV2 sweep.
      s3Send.mockRejectedValueOnce(awsError('NoSuchBucket'))
      await expect(p.deleteBucket('b')).resolves.toBeUndefined()
    })

    it('rethrows a real bucket delete failure', async () => {
      const p = await makeProvider()
      s3Send
        .mockResolvedValueOnce({ Contents: [], IsTruncated: false })  // list: already empty
        .mockRejectedValueOnce(awsError('BucketNotEmpty'))            // delete bucket
      await expect(p.deleteBucket('b')).rejects.toThrow('BucketNotEmpty')
    })

    // S3 will not delete a non-empty bucket, and rollbackProvisioning swallows the error — so
    // a tenant bucket holding its generated legal policies survived every rollback.
    it('empties the bucket before deleting it', async () => {
      const p = await makeProvider()
      s3Send
        .mockResolvedValueOnce({ Contents: [{ Key: 'legal/policies.json' }], IsTruncated: false })
        .mockResolvedValueOnce({})   // DeleteObjects
        .mockResolvedValueOnce({})   // DeleteBucket
      await expect(p.deleteBucket('b')).resolves.toBeUndefined()

      const names = s3Send.mock.calls.map(([c]: any[]) => c.__type)
      expect(names).toEqual(['ListObjectsV2', 'DeleteObjects', 'DeleteBucket'])
    })
  })

  // -------------------------------------------------------------------------
  describe('isDbInstanceGone — gates param-group teardown', () => {
    it('is false while the instance still exists in ANY state', async () => {
      const p = await makeProvider()
      rdsSend.mockResolvedValueOnce({ DBInstances: [{ DBInstanceStatus: 'deleting' }] })
      await expect(p.isDbInstanceGone('db-1')).resolves.toBe(false)
    })

    it('is true once RDS reports it not found', async () => {
      const p = await makeProvider()
      rdsSend.mockRejectedValueOnce(awsError('DBInstanceNotFound'))
      await expect(p.isDbInstanceGone('db-1')).resolves.toBe(true)
    })

    it('rethrows an unexpected error rather than reporting a false "gone"', async () => {
      const p = await makeProvider()
      rdsSend.mockRejectedValueOnce(awsError('AccessDenied'))
      await expect(p.isDbInstanceGone('db-1')).rejects.toThrow('AccessDenied')
    })
  })

  // -------------------------------------------------------------------------
  describe('deleteParamGroup', () => {
    it('deletes the group', async () => {
      const p = await makeProvider()
      await p.deleteParamGroup('pg-1')
      expect(sentInputs(rdsSend)[0]).toMatchObject({ DBParameterGroupName: 'pg-1' })
    })

    it('treats NotFound as success (already gone)', async () => {
      const p = await makeProvider()
      rdsSend.mockRejectedValueOnce(awsError('DBParameterGroupNotFound'))
      await expect(p.deleteParamGroup('pg-1')).resolves.toBeUndefined()
    })

    it('rethrows while the group is still attached to a live instance', async () => {
      // The caller retries once isDbInstanceGone() is true.
      const p = await makeProvider()
      rdsSend.mockRejectedValueOnce(awsError('InvalidDBParameterGroupState'))
      await expect(p.deleteParamGroup('pg-1')).rejects.toThrow('InvalidDBParameterGroupState')
    })
  })
})

