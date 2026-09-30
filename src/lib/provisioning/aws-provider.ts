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
} from '@aws-sdk/client-rds'
import {
  S3Client,
  CreateBucketCommand,
  PutPublicAccessBlockCommand,
  PutBucketPolicyCommand,
  PutBucketCorsCommand,
  DeleteBucketCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3'
import { Pool } from 'pg'
import { createPgPool, rdsSslOption } from '@/lib/shared/pg-pool'
import { buildTenantSchemaSql } from '@/lib/tenant-migrations-schema'
import { dumpTenantDb, restoreTenantDb } from '@/lib/tenancy/tenant-db-backup'
import { upsertTenantDns, deleteTenantDns } from '@/lib/tenancy/tenant-dns'
import type { ProvisioningProvider, CreateDbInstanceArgs } from './provider'

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
const RDS_MASTER_USER = process.env.TENANT_RDS_MASTER_USER || 'postgres'
const APP_IAM_USER = process.env.RDS_USER || 'app_user'

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

  async createDbInstance(args: CreateDbInstanceArgs): Promise<{ dbInstanceId: string }> {
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
    try {
      await this.rds.send(
        new CreateDBInstanceCommand({
          DBInstanceIdentifier: args.dbInstanceId,
          DBInstanceClass: RDS_INSTANCE_CLASS,
          Engine: 'postgres',
          EngineVersion: RDS_ENGINE_VERSION,
          AllocatedStorage: 20,
          MasterUsername: RDS_MASTER_USER,
          MasterUserPassword: process.env.RDS_MASTER_PASSWORD,
          DBName: 'jeffi_stores',
          VpcSecurityGroupIds: [RDS_SG],
          DBSubnetGroupName: RDS_SUBNET_GROUP,
          DBParameterGroupName: args.paramGroup,
          PubliclyAccessible: publicTest,
          EnableIAMDatabaseAuthentication: true,
          StorageType: 'gp3',
          StorageEncrypted: true,
          BackupRetentionPeriod: 7,
          Tags: [
            { Key: 'app', Value: 'jeffi-stores' },
            { Key: 'kind', Value: 'tenant-db' },
          ],
        })
      )
    } catch (err) {
      if (!isAlreadyExists(err)) throw err
    }
    return { dbInstanceId: args.dbInstanceId }
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

  async getDbEndpoint(dbInstanceId: string): Promise<string | null> {
    const res = await this.rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: dbInstanceId }))
    const inst = res.DBInstances?.[0]
    if (inst?.DBInstanceStatus === 'available' && inst.Endpoint?.Address) {
      return inst.Endpoint.Address
    }
    return null
  }

  async loadSchema(endpoint: string, dbName: string): Promise<void> {
    const pool = this.tenantPool(endpoint, dbName)
    try {
      // 1. Apply desired-state schema (reuse the fan-out builder for identical ordering)
      await pool.query(buildTenantSchemaSql())

      // 2. Create the app_user role with rds_iam so the app can connect via IAM token
      await pool.query(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${APP_IAM_USER}') THEN
            CREATE ROLE ${APP_IAM_USER} LOGIN;
          END IF;
        END $$;
        GRANT rds_iam TO ${APP_IAM_USER};
        GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${APP_IAM_USER};
        GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${APP_IAM_USER};
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${APP_IAM_USER};
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ${APP_IAM_USER};
      `)
    } finally {
      await pool.end().catch(() => {})
    }
  }

  async backupDb(endpoint: string, dbName: string): Promise<Buffer> {
    const pool = this.tenantPool(endpoint, dbName)
    try {
      return await dumpTenantDb(pool, { database: dbName })
    } finally {
      await pool.end().catch(() => {})
    }
  }

  async restoreDb(endpoint: string, dbName: string, archive: Buffer): Promise<void> {
    const pool = this.tenantPool(endpoint, dbName)
    try {
      await restoreTenantDb(pool, archive)
    } finally {
      await pool.end().catch(() => {})
    }
  }

  /** Build a pg pool to a tenant DB as the MASTER user (for DDL + data ops).
   * The master user (postgres) authenticates by PASSWORD, not IAM — IAM auth only
   * works for roles explicitly granted rds_iam (e.g. app_user, which loadSchema creates).
   * Uses RDS_MASTER_PASSWORD, the same secret passed to CreateDBInstance. */
  private tenantPool(endpoint: string, dbName: string): Pool {
    const masterPassword = process.env.RDS_MASTER_PASSWORD
    if (!masterPassword) {
      throw new Error(
        'RDS_MASTER_PASSWORD is not set — required to connect as the tenant DB master user for schema load / backup / restore'
      )
    }
    return createPgPool({
      host: endpoint,
      port: 5432,
      database: dbName,
      user: RDS_MASTER_USER,
      password: masterPassword,
      ssl: rdsSslOption(),
      max: 2,
      connectionTimeoutMillis: 20000,
    })
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
    // with IAM creds; the policy below only opens read + the app's own write, mirroring
    // jeffi-stores-bucket. Public access block must be OFF for the policy to take effect.
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
            {
              Sid: 'AllowUploadFromApplication',
              Effect: 'Allow',
              Principal: '*',
              Action: ['s3:PutObject', 's3:PutObjectAcl', 's3:DeleteObject'],
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
