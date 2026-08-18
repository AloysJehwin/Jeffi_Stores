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
  PutBucketCorsCommand,
  DeleteBucketCommand,
} from '@aws-sdk/client-s3'
import { Pool } from 'pg'
import fs from 'fs'
import path from 'path'
import type { ProvisioningProvider, CreateDbInstanceArgs } from './provider'

/**
 * Real AWS provisioning provider (Route/RDS/S3).
 *
 * ⚠️ NEEDS LIVE AWS TO VERIFY — cannot be tested locally. Each method maps to a
 * real @aws-sdk call and treats "already exists / already owned" as success so the
 * state machine can safely retry after crashes.
 *
 * Locked infra (from docs/PROVISIONING_ENGINE_PLAN.md):
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
      await this.rds.send(new CreateDBParameterGroupCommand({
        DBParameterGroupName: paramGroup,
        DBParameterGroupFamily: `postgres${RDS_ENGINE_VERSION}`,
        Description: `Jeffi tenant param group (max_connections=${maxConnections})`,
      }))
    } catch (err) {
      if (!isAlreadyExists(err)) throw err
    }
    // max_connections is static → pending-reboot
    await this.rds.send(new ModifyDBParameterGroupCommand({
      DBParameterGroupName: paramGroup,
      Parameters: [{
        ParameterName: 'max_connections',
        ParameterValue: String(maxConnections),
        ApplyMethod: 'pending-reboot',
      }],
    }))
  }

  async createDbInstance(args: CreateDbInstanceArgs): Promise<{ dbInstanceId: string }> {
    try {
      await this.rds.send(new CreateDBInstanceCommand({
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
        PubliclyAccessible: false,
        EnableIAMDatabaseAuthentication: true,
        StorageType: 'gp3',
        StorageEncrypted: true,
        BackupRetentionPeriod: 7,
        Tags: [{ Key: 'app', Value: 'jeffi-stores' }, { Key: 'kind', Value: 'tenant-db' }],
      }))
    } catch (err) {
      if (!isAlreadyExists(err)) throw err
    }
    return { dbInstanceId: args.dbInstanceId }
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
      const { buildTenantSchemaSql } = await import('../tenant-migrations-schema')
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
    const { dumpTenantDb } = await import('../tenant-db-backup')
    const pool = this.tenantPool(endpoint, dbName)
    try {
      return await dumpTenantDb(pool, { database: dbName })
    } finally {
      await pool.end().catch(() => {})
    }
  }

  async restoreDb(endpoint: string, dbName: string, archive: Buffer): Promise<void> {
    const { restoreTenantDb } = await import('../tenant-db-backup')
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
      throw new Error('RDS_MASTER_PASSWORD is not set — required to connect as the tenant DB master user for schema load / backup / restore')
    }
    const certPath = path.join(process.cwd(), 'certs', 'global-bundle.pem')
    const ssl = fs.existsSync(certPath)
      ? { rejectUnauthorized: true, ca: fs.readFileSync(certPath).toString() }
      : { rejectUnauthorized: false }
    return new Pool({
      host: endpoint, port: 5432, database: dbName, user: RDS_MASTER_USER,
      password: masterPassword, ssl, max: 2, connectionTimeoutMillis: 20000,
    })
  }

  async ensureBucket(bucket: string): Promise<void> {
    try {
      await this.s3.send(new CreateBucketCommand({ Bucket: bucket }))
    } catch (err) {
      if (!isAlreadyExists(err)) throw err
    }
    // Block ALL public access — app writes via IAM, CloudFront reads via OAC
    await this.s3.send(new PutPublicAccessBlockCommand({
      Bucket: bucket,
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true, IgnorePublicAcls: true,
        BlockPublicPolicy: true, RestrictPublicBuckets: true,
      },
    }))
    await this.s3.send(new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: {
        CORSRules: [{
          AllowedMethods: ['GET', 'PUT', 'POST'],
          AllowedOrigins: ['https://*.jeffistores.in'],
          AllowedHeaders: ['*'],
          MaxAgeSeconds: 3000,
        }],
      },
    }))
  }

  async ensureDns(hostnames: string[]): Promise<void> {
    const { upsertTenantDns } = await import('../tenant-dns')
    await upsertTenantDns(hostnames)
  }

  async removeDns(hostnames: string[]): Promise<void> {
    const { deleteTenantDns } = await import('../tenant-dns')
    await deleteTenantDns(hostnames)
  }

  async stopDbInstance(dbInstanceId: string): Promise<void> {
    await this.rds.send(new StopDBInstanceCommand({ DBInstanceIdentifier: dbInstanceId }))
  }

  async startDbInstance(dbInstanceId: string): Promise<void> {
    await this.rds.send(new StartDBInstanceCommand({ DBInstanceIdentifier: dbInstanceId }))
  }

  async deleteDbInstance(dbInstanceId: string): Promise<void> {
    await this.rds.send(new DeleteDBInstanceCommand({
      DBInstanceIdentifier: dbInstanceId,
      SkipFinalSnapshot: true,
      DeleteAutomatedBackups: true,
    })).catch((err) => { if (!/NotFound/i.test(err?.name || '')) throw err })
  }

  async deleteBucket(bucket: string): Promise<void> {
    await this.s3.send(new DeleteBucketCommand({ Bucket: bucket }))
      .catch((err) => { if (!/NoSuchBucket/i.test(err?.name || '')) throw err })
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
    await this.rds.send(new DeleteDBParameterGroupCommand({ DBParameterGroupName: paramGroup }))
      .catch((err) => {
        const name = err?.name || ''
        // NotFound → already gone (success). InvalidDBParameterGroupState → still attached
        // to an instance that isn't fully deleted yet; caller retries after DB is gone.
        if (/DBParameterGroupNotFound|NotFound/i.test(name)) return
        throw err
      })
  }
}
