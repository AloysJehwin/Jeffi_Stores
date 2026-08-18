// Provisioning AWS provider — the seam between the state machine and real AWS.
//
// The state machine (steps.ts) only ever calls this interface, so we can:
//   1. run the full flow locally with StubProvisioningProvider (no real infra)
//   2. later swap in the real @aws-sdk implementation ONE method at a time,
//      each verified against a real test RDS before enabling the next.
//
// Every method must be IDEMPOTENT and safe to retry (the worker re-runs steps
// after crashes) — treat "already exists / already owned" as success.

export interface CreateDbInstanceArgs {
  dbInstanceId: string        // jeffi-tenant-{slug}
  paramGroup: string
  maxConnections: number
}

export interface ProvisioningProvider {
  /** Create (or confirm) a custom parameter group with the given max_connections. */
  ensureParamGroup(paramGroup: string, maxConnections: number): Promise<void>

  /** Create the RDS instance (idempotent). Returns immediately; not yet available. */
  createDbInstance(args: CreateDbInstanceArgs): Promise<{ dbInstanceId: string }>

  /** Poll: is the instance 'available' yet? Returns endpoint when ready, null while pending. */
  getDbEndpoint(dbInstanceId: string): Promise<string | null>

  /** Run the full desired-state schema + create app_user WITH rds_iam on the fresh DB. */
  loadSchema(endpoint: string, dbName: string): Promise<void>

  /** Snapshot the tenant DB to a gzip'd archive (pure-JS, no pg_dump binary). */
  backupDb(endpoint: string, dbName: string): Promise<Buffer>

  /** Restore a gzip'd archive into a fresh (schema-loaded) tenant DB. */
  restoreDb(endpoint: string, dbName: string, archive: Buffer): Promise<void>

  /** Create + lock down the tenant bucket (public-access-block on; writes to app IAM only). */
  ensureBucket(bucket: string): Promise<void>

  /** Point the tenant's subdomains at the shared app host (Route53 A-records; idempotent). */
  ensureDns(hostnames: string[]): Promise<void>

  /** Remove the tenant's subdomain A-records on deprovision (idempotent). */
  removeDns(hostnames: string[]): Promise<void>

  /** Stop the RDS instance (cost saving — test tenant only). */
  stopDbInstance(dbInstanceId: string): Promise<void>

  /** Start a stopped RDS instance. */
  startDbInstance(dbInstanceId: string): Promise<void>

  /** Rollback: delete resources created by a failed provision (no leaked billing). */
  deleteDbInstance(dbInstanceId: string): Promise<void>
  deleteBucket(bucket: string): Promise<void>

  /** True once the RDS instance no longer exists (teardown ordering before param-group delete). */
  isDbInstanceGone(dbInstanceId: string): Promise<boolean>

  /** Delete the tenant's custom parameter group (idempotent; NotFound = success). Only
   * succeeds once no instance references it, so callers must delete the DB first. */
  deleteParamGroup(paramGroup: string): Promise<void>
}
