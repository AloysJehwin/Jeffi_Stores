import {
  RDSClient,
  CreateDBParameterGroupCommand,
  ModifyDBParameterGroupCommand,
  DeleteDBParameterGroupCommand,
  CreateDBInstanceCommand,
  DescribeDBInstancesCommand,
  StopDBInstanceCommand,
  StartDBInstanceCommand,
  DeleteDBInstanceCommand,
  ModifyDBInstanceCommand,
} from '@aws-sdk/client-rds'
import {
  S3Client,
  CreateBucketCommand,
  PutPublicAccessBlockCommand,
  PutBucketPolicyCommand,
  PutBucketCorsCommand,
  DeleteBucketCommand,
  ListObjectsV2Command,
  CopyObjectCommand,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3'
import type { Pool } from 'pg'
import { buildTenantSchemaSql } from '@controller/lib/tenant-migrations-schema'
import { dumpTenantDb, restoreTenantDb } from '@controller/lib/tenancy/tenant-db-backup'
import { upsertTenantDns, deleteTenantDns } from '@controller/lib/tenancy/tenant-dns'
import type { ProvisioningProvider, CreateDbInstanceArgs, DbInstanceState, ModifyDbInstanceArgs } from './provider'
import { dbTarget, isNodeDb, tenantAdminPool, type DbAuth } from './tenant-admin-pool'

/**
 * Real AWS provisioning provider (Route/RDS/S3).
 *
 * NEEDS LIVE AWS TO VERIFY — cannot be tested locally. Each method maps to a
 * real @aws-sdk call and treats "already exists / already owned" as success so the
 * state machine can safely retry after crashes.
 *
 * Locked infra (from docs/archive/PROVISIONING_ENGINE_PLAN.md):
 *   VPC vpc-04bd02e91e0bc0882, RDS SG sg-0e361f0f1b093bd83, region us-east-1
 *
 * Enable with PROVISIONING_PROVIDER=aws.
 */

const REGION = process.env.AWS_REGION || 'us-east-1'
const RDS_SG = process.env.TENANT_RDS_SECURITY_GROUP || 'sg-0e361f0f1b093bd83'
const RDS_SUBNET_GROUP = process.env.TENANT_RDS_SUBNET_GROUP || 'default'
const RDS_INSTANCE_CLASS = process.env.TENANT_RDS_CLASS || 'db.t4g.micro'
const RDS_ENGINE_VERSION = process.env.TENANT_RDS_PG_VERSION || '16'

/** Class/storage combos tried in order when AWS reports no capacity: the class, then the same size on t3. */
export function rdsShapes(cls = RDS_INSTANCE_CLASS): Array<{ cls: string; storage: 'gp3' | 'gp2' }> {
  const classes = cls.includes('.t4g.') ? [cls, cls.replace('.t4g.', '.t3.')] : [cls]
  return classes.flatMap(c => [
    { cls: c, storage: 'gp3' as const },
    { cls: c, storage: 'gp2' as const },
  ])
}

export function isInsufficientCapacity(err: unknown): boolean {
  const e = err as { name?: string; Code?: string; message?: string }
  return (
    e?.name === 'InsufficientDBInstanceCapacityFault' ||
    e?.name === 'InsufficientDBInstanceCapacity' ||
    e?.Code === 'InsufficientDBInstanceCapacity' ||
    /sufficient capacity/i.test(e?.message || '')
  )
}
const RDS_MASTER_USER = process.env.TENANT_RDS_MASTER_USER || 'postgres'
const APP_IAM_USER = process.env.RDS_USER || 'app_user'

/** A SQL identifier built from a slug (t_{slug}, app_{slug}); anything but lowercase letters, digits and _ is refused. */
function ident(name: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name)) throw new Error(`refusing SQL identifier "${name}"`)
  return name
}

function isAlreadyExists(err: any): boolean {
  const code = err?.name || err?.Code || ''
  return /AlreadyExists|AlreadyOwnedByYou|DBInstanceAlreadyExists|DBParameterGroupAlreadyExists/i.test(code)
}

export class AwsProvisioningProvider implements ProvisioningProvider {
  private rds = new RDSClient({ region: REGION })
  private s3 = new S3Client({ region: REGION })

  async ensureParamGroup(paramGroup: string, maxConnections: number): Promise<void> {
    try {
      await this.rds.send(
        new CreateDBParameterGroupCommand({
          DBParameterGroupName: paramGroup,
          DBParameterGroupFamily: `postgres${RDS_ENGINE_VERSION}`,
          Description: `Jeffi tenant param group (max_connections=${maxConnections})`,
        })
      )
    } catch (err) {
      if (!isAlreadyExists(err)) throw err
    }
    // max_connections is static → pending-reboot
    await this.rds.send(
      new ModifyDBParameterGroupCommand({
        DBParameterGroupName: paramGroup,
        Parameters: [
          {
            ParameterName: 'max_connections',
            ParameterValue: String(maxConnections),
            ApplyMethod: 'pending-reboot',
          },
        ],
      })
    )
  }

  async createDbInstance(args: CreateDbInstanceArgs): Promise<{ dbInstanceId: string; instanceClass?: string }> {
    // LOCAL-TEST ONLY: TENANT_RDS_PUBLIC_TEST=true creates the tenant RDS publicly accessible so
    // a laptop outside the VPC can run load_schema/backup without manually flipping visibility +
    // SG each run. NEVER set in production — prod tenant DBs must stay PubliclyAccessible:false
    // (the default when the flag is absent).
    const publicTest = process.env.TENANT_RDS_PUBLIC_TEST === 'true'
    // Public accessibility alone is not enough: the RDS security group must also admit this
    // machine's IP on 5432, or load_schema/restore/backup hang until the 20s connect timeout.
    // Under the same flag, self-authorize the current public IP so a local run is turnkey.
    // Best-effort — a failure here is logged, not fatal: the DB may still be reachable (IP
    // already allowed, or running in-VPC), and createDbInstance must stay retry-safe.
    if (publicTest) await this.openLocalRdsAccess()
    // AWS sometimes has no capacity for a class/storage combo in any AZ — fall through to the next.
    let lastErr: unknown
    const storageGb = args.storageGb ?? 20
    for (const { cls, storage } of rdsShapes(args.instanceClass)) {
      try {
        await this.rds.send(
          new CreateDBInstanceCommand({
            DBInstanceIdentifier: args.dbInstanceId,
            DBInstanceClass: cls,
            Engine: 'postgres',
            EngineVersion: RDS_ENGINE_VERSION,
            AllocatedStorage: storageGb,
            // Storage autoscaling headroom so a full disk never takes the store down.
            MaxAllocatedStorage: storageGb * 2,
            MultiAZ: !!args.multiAz,
            MasterUsername: RDS_MASTER_USER,
            MasterUserPassword: process.env.RDS_MASTER_PASSWORD,
            DBName: 'jeffi_stores',
            VpcSecurityGroupIds: [RDS_SG],
            DBSubnetGroupName: RDS_SUBNET_GROUP,
            DBParameterGroupName: args.paramGroup,
            PubliclyAccessible: publicTest,
            EnableIAMDatabaseAuthentication: true,
            StorageType: storage,
            StorageEncrypted: true,
            BackupRetentionPeriod: 7,
            Tags: [
              { Key: 'app', Value: 'jeffi-stores' },
              { Key: 'kind', Value: 'tenant-db' },
            ],
          })
        )
        return { dbInstanceId: args.dbInstanceId, instanceClass: cls }
      } catch (err) {
        if (isAlreadyExists(err)) return { dbInstanceId: args.dbInstanceId }
        if (!isInsufficientCapacity(err)) throw err
        console.error(`[provisioning] no RDS capacity for ${cls}/${storage} (${args.dbInstanceId}); trying next shape`)
        lastErr = err
      }
    }
    throw lastErr
  }

  /**
   * LOCAL-TEST ONLY. Authorize this machine's public IP on 5432 in the tenant RDS security
   * group, so a laptop outside the VPC can complete the data-plane steps (load_schema /
   * restore_data / backup). Only ever called behind TENANT_RDS_PUBLIC_TEST — never in prod.
   *
   * Never throws: provisioning must not fail because the SG could not be widened (the caller
   * may already have access, or be running in-VPC where none of this is needed).
   */
  private async openLocalRdsAccess(): Promise<void> {
    try {
      const { currentPublicIp, authorizeSgIngress } = await import('@/lib/shared/ec2-client')
      const ip = await currentPublicIp()
      if (!ip) {
        process.stderr.write(
          '[provisioning] TENANT_RDS_PUBLIC_TEST: could not detect public IP; skipping SG self-authorize\n'
        )
        return
      }
      await authorizeSgIngress({
        groupId: RDS_SG,
        cidr: `${ip}/32`,
        port: 5432,
        description: `jeffi-local-test ${new Date().toISOString().slice(0, 10)} (safe to revoke)`,
      })
      process.stderr.write(`[provisioning] TENANT_RDS_PUBLIC_TEST: authorized ${ip}/32 on 5432 in ${RDS_SG}\n`)
    } catch (err: any) {
      process.stderr.write(
        `[provisioning] TENANT_RDS_PUBLIC_TEST: SG self-authorize failed (continuing): ${err?.message}\n`
      )
    }
  }

  async describeDbInstance(dbInstanceId: string): Promise<DbInstanceState | null> {
    try {
      const res = await this.rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: dbInstanceId }))
      const i = res.DBInstances?.[0]
      if (!i) return null
      const pv = i.PendingModifiedValues ?? {}
      return {
        status: i.DBInstanceStatus ?? '',
        instanceClass: i.DBInstanceClass ?? '',
        storageGb: i.AllocatedStorage ?? 0,
        multiAz: !!i.MultiAZ,
        pending: [pv.DBInstanceClass, pv.AllocatedStorage, pv.MultiAZ, pv.StorageType, pv.Iops].some(v => v != null),
      }
    } catch (err: any) {
      if (/DBInstanceNotFound/i.test(err?.name || err?.Code || '')) return null
      throw err
    }
  }

  async modifyDbInstance(dbInstanceId: string, args: ModifyDbInstanceArgs): Promise<void> {
    await this.rds.send(
      new ModifyDBInstanceCommand({
        DBInstanceIdentifier: dbInstanceId,
        ...(args.instanceClass ? { DBInstanceClass: args.instanceClass } : {}),
        ...(args.storageGb ? { AllocatedStorage: args.storageGb, MaxAllocatedStorage: args.storageGb * 2 } : {}),
        ...(args.multiAz != null ? { MultiAZ: args.multiAz } : {}),
        ApplyImmediately: args.applyImmediately,
      })
    )
  }

  async getDbEndpoint(dbInstanceId: string): Promise<string | null> {
    const res = await this.rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: dbInstanceId }))
    const inst = res.DBInstances?.[0]
    if (inst?.DBInstanceStatus === 'available' && inst.Endpoint?.Address) {
      return inst.Endpoint.Address
    }
    return null
  }

  async loadSchema(endpoint: string, dbName: string, appUser = APP_IAM_USER, db?: DbAuth): Promise<void> {
    const user = ident(appUser)
    const target = dbTarget(endpoint, dbName, db)
    const pool = await tenantAdminPool(target)
    try {
      // 1. Apply desired-state schema (reuse the fan-out builder for identical ordering)
      await pool.query(buildTenantSchemaSql())
      // An on-node Postgres has no rds_iam and no app login: the store connects as its superuser.
      if (isNodeDb(target)) return

      // 2. Create the app login role with rds_iam so the app can connect via IAM token
      await pool.query(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${appUser}') THEN
            CREATE ROLE ${user} LOGIN;
          END IF;
        END $$;
        GRANT rds_iam TO ${user};
        GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${user};
        GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${user};
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${user};
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ${user};
      `)
    } finally {
      await pool.end().catch(() => {})
    }
  }

  async initSharedDbHost(endpoint: string): Promise<void> {
    const pool = await this.tenantPool(endpoint, 'postgres')
    try {
      for (const db of ['postgres', 'template1', 'jeffi_stores']) {
        const found = await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [db])
        if (found.rowCount) await pool.query(`REVOKE CONNECT, TEMPORARY ON DATABASE ${ident(db)} FROM PUBLIC`)
      }
    } finally {
      await pool.end().catch(() => {})
    }
  }

  async createTenantDatabase(endpoint: string, dbName: string, role: string): Promise<void> {
    const pool = await this.tenantPool(endpoint, 'postgres')
    try {
      const found = await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName])
      if (!found.rowCount) await pool.query(`CREATE DATABASE ${ident(dbName)}`)
      await pool.query(`REVOKE CONNECT, TEMPORARY ON DATABASE ${ident(dbName)} FROM PUBLIC`)
      const exists = await pool.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role])
      if (!exists.rowCount) await pool.query(`CREATE ROLE ${ident(role)} LOGIN`)
      await pool.query(`GRANT rds_iam TO ${ident(role)}`)
      await pool.query(`GRANT CONNECT ON DATABASE ${ident(dbName)} TO ${ident(role)}`)
    } finally {
      await pool.end().catch(() => {})
    }
  }

  async dropTenantDatabase(endpoint: string, dbName: string, role: string | null): Promise<void> {
    const pool = await this.tenantPool(endpoint, 'postgres')
    try {
      await pool.query(`DROP DATABASE IF EXISTS ${ident(dbName)} WITH (FORCE)`)
      if (role) await pool.query(`DROP ROLE IF EXISTS ${ident(role)}`)
    } finally {
      await pool.end().catch(() => {})
    }
  }

  async backupDb(endpoint: string, dbName: string, db?: DbAuth): Promise<Buffer> {
    const pool = await tenantAdminPool(dbTarget(endpoint, dbName, db))
    try {
      return await dumpTenantDb(pool, { database: dbName })
    } finally {
      await pool.end().catch(() => {})
    }
  }

  async restoreDb(endpoint: string, dbName: string, archive: Buffer, db?: DbAuth): Promise<void> {
    const pool = await tenantAdminPool(dbTarget(endpoint, dbName, db))
    try {
      await restoreTenantDb(pool, archive)
    } finally {
      await pool.end().catch(() => {})
    }
  }

  /** A shared Starter host's maintenance database as the RDS master user (password, not IAM). */
  private tenantPool(endpoint: string, dbName: string): Promise<Pool> {
    return tenantAdminPool({ endpoint, dbName })
  }

  async ensureBucket(bucket: string): Promise<void> {
    try {
      await this.s3.send(new CreateBucketCommand({ Bucket: bucket }))
    } catch (err) {
      if (!isAlreadyExists(err)) throw err
    }
    // Tenant objects (product images, invoices) are served by direct public S3 URL — the same
    // read model as the platform bucket (s3.ts publicUrl). There is no per-tenant CloudFront, so
    // the bucket must allow public read or every uploaded image 403s on display. The app writes
    // with IAM creds (jeffi-tenant-app-role), so the policy opens public READ only — never write.
    // Public access block must be OFF for the policy to take effect.
    await this.s3.send(
      new PutPublicAccessBlockCommand({
        Bucket: bucket,
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: false,
          IgnorePublicAcls: false,
          BlockPublicPolicy: false,
          RestrictPublicBuckets: false,
        },
      })
    )
    await this.s3.send(
      new PutBucketPolicyCommand({
        Bucket: bucket,
        Policy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Sid: 'PublicReadAccess',
              Effect: 'Allow',
              Principal: '*',
              Action: ['s3:GetObject', 's3:GetObjectVersion'],
              Resource: `arn:aws:s3:::${bucket}/*`,
            },
          ],
        }),
      })
    )
    await this.s3.send(
      new PutBucketCorsCommand({
        Bucket: bucket,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedMethods: ['GET', 'PUT', 'POST'],
              AllowedOrigins: ['https://*.jeffistores.in'],
              AllowedHeaders: ['*'],
              MaxAgeSeconds: 3000,
            },
          ],
        },
      })
    )
  }

  async ensureDns(hostnames: string[], targetIp?: string): Promise<void> {
    await upsertTenantDns(hostnames, targetIp)
  }

  async removeDns(hostnames: string[]): Promise<void> {
    await deleteTenantDns(hostnames)
  }

  async stopDbInstance(dbInstanceId: string): Promise<void> {
    await this.rds.send(new StopDBInstanceCommand({ DBInstanceIdentifier: dbInstanceId }))
  }

  async startDbInstance(dbInstanceId: string): Promise<void> {
    await this.rds.send(new StartDBInstanceCommand({ DBInstanceIdentifier: dbInstanceId }))
  }

  async deleteDbInstance(dbInstanceId: string): Promise<void> {
    await this.rds
      .send(
        new DeleteDBInstanceCommand({
          DBInstanceIdentifier: dbInstanceId,
          SkipFinalSnapshot: true,
          DeleteAutomatedBackups: true,
        })
      )
      .catch(err => {
        if (!/NotFound/i.test(err?.name || '')) throw err
      })
  }

  /** Server-side copy of every object under `fromPrefix` in one bucket to `toPrefix` in another. */
  private async copyObjects(from: { bucket: string; prefix: string }, to: { bucket: string; prefix: string }) {
    let objects = 0
    let bytes = 0
    let token: string | undefined
    do {
      const listed = await this.s3.send(
        new ListObjectsV2Command({ Bucket: from.bucket, Prefix: from.prefix || undefined, ContinuationToken: token, MaxKeys: 1000 })
      )
      for (const o of listed.Contents ?? []) {
        if (!o.Key) continue
        // CopyObject takes objects up to 5 GB; a larger one fails the copy, and with it the step that asked.
        await this.s3.send(
          new CopyObjectCommand({
            Bucket: to.bucket,
            Key: `${to.prefix}${o.Key.slice(from.prefix.length)}`,
            CopySource: `${from.bucket}/${o.Key.split('/').map(encodeURIComponent).join('/')}`,
          })
        )
        objects++
        bytes += o.Size ?? 0
      }
      token = listed.IsTruncated ? listed.NextContinuationToken : undefined
    } while (token)
    return { objects, bytes }
  }

  async archiveBucket(bucket: string, destPrefix: string): Promise<{ objects: number; bytes: number }> {
    const { backupBucket } = await import('@/lib/tenancy/tenant-backup-store')
    try {
      return await this.copyObjects({ bucket, prefix: '' }, { bucket: backupBucket(), prefix: destPrefix })
    } catch (err: any) {
      if (/NoSuchBucket/i.test(err?.name || '')) return { objects: 0, bytes: 0 }
      throw err
    }
  }

  async restoreBucket(srcPrefix: string, bucket: string): Promise<{ objects: number }> {
    const { backupBucket } = await import('@/lib/tenancy/tenant-backup-store')
    const { objects } = await this.copyObjects({ bucket: backupBucket(), prefix: srcPrefix }, { bucket, prefix: '' })
    return { objects }
  }

  async readSiteSettings(endpoint: string, dbName: string, db?: DbAuth): Promise<Record<string, string>> {
    const pool = await tenantAdminPool(dbTarget(endpoint, dbName, db))
    try {
      const r = await pool.query(`SELECT key, value FROM site_settings WHERE value IS NOT NULL AND value <> ''`)
      return Object.fromEntries(r.rows.map((x: { key: string; value: string }) => [x.key, String(x.value)]))
    } finally {
      await pool.end().catch(() => {})
    }
  }

  async deleteBucket(bucket: string): Promise<void> {
    // S3 refuses to delete a non-empty bucket, and by rollback time the bucket usually holds
    // at least the generated legal policies — so the delete failed and the caller's catch
    // swallowed it, leaving the bucket behind. Empty it first.
    try {
      for (;;) {
        const listed = await this.s3.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1000 }))
        const keys = (listed.Contents ?? []).map(o => ({ Key: o.Key! })).filter(o => o.Key)
        if (keys.length === 0) break
        await this.s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys, Quiet: true } }))
        if (!listed.IsTruncated) break
      }
    } catch (err: any) {
      if (!/NoSuchBucket/i.test(err?.name || '')) throw err
      return
    }

    await this.s3.send(new DeleteBucketCommand({ Bucket: bucket })).catch(err => {
      if (!/NoSuchBucket/i.test(err?.name || '')) throw err
    })
  }

  async isDbInstanceGone(dbInstanceId: string): Promise<boolean> {
    try {
      await this.rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: dbInstanceId }))
      return false // still exists (any state)
    } catch (err: any) {
      if (/DBInstanceNotFound|NotFound/i.test(err?.name || '')) return true
      throw err
    }
  }

  async deleteParamGroup(paramGroup: string): Promise<void> {
    await this.rds.send(new DeleteDBParameterGroupCommand({ DBParameterGroupName: paramGroup })).catch(err => {
      const name = err?.name || ''
      // NotFound → already gone (success). InvalidDBParameterGroupState → still attached
      // to an instance that isn't fully deleted yet; caller retries after DB is gone.
      if (/DBParameterGroupNotFound|NotFound/i.test(name)) return
      throw err
    })
  }

  // EC2 app instances (dedicated-tenant or shared pool) via the SigV4 ec2-client (no
  // @aws-sdk/client-ec2, matching pool-autoscale). userData boots the same app Docker image.
  async ensureAppInstance(
    args: { name: string; instanceType: string; userData?: string },
    onLaunched?: (instanceId: string) => Promise<void>
  ): Promise<{ instanceId: string; ip: string }> {
    const { runInstance, waitForState, getInstanceIp } = await import('@/lib/shared/ec2-client')
    const { instanceId } = await runInstance(args)
    // Record the id BEFORE waiting. Everything below can throw, and an id known only to this
    // stack frame is an instance nothing can find again — it stays running, billing, and
    // invisible to rollback. This is how i-0540e06e9fb896c2f was orphaned.
    if (onLaunched) await onLaunched(instanceId).catch(() => {})
    await waitForState(instanceId, 'running')
    // Public IP can lag 'running' by a moment — poll briefly.
    let ip: string | null = null
    for (let i = 0; i < 10 && !ip; i++) {
      ip = await getInstanceIp(instanceId)
      if (!ip) await new Promise(r => setTimeout(r, 3000))
    }
    if (!ip) throw new Error(`EC2 ${instanceId} running but no public IP assigned`)
    return { instanceId, ip }
  }

  async deleteAppInstance(instanceId: string): Promise<void> {
    const { terminateInstance } = await import('@/lib/shared/ec2-client')
    await terminateInstance(instanceId).catch((e: any) => {
      if (!/NotFound|InvalidInstanceID/i.test(e?.message || '')) throw e
    })
  }

  async isInstanceGone(instanceId: string): Promise<boolean> {
    const { isInstanceGone } = await import('@/lib/shared/ec2-client')
    return isInstanceGone(instanceId)
  }
}
