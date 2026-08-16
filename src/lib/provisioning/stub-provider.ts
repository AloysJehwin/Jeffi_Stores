import type { ProvisioningProvider, CreateDbInstanceArgs } from './provider'

// In-memory stub: exercises the FULL state machine (including the async
// "wait until available" polling) with zero real AWS. Swap for the real
// @aws-sdk provider one method at a time, each verified against a test RDS.
export class StubProvisioningProvider implements ProvisioningProvider {
  // instanceId -> ticks remaining before it reports 'available' (simulates the ~5-10 min wait)
  private pending = new Map<string, number>()
  private endpoints = new Map<string, string>()
  private stopped = new Set<string>()
  private buckets = new Set<string>()
  private paramGroups = new Set<string>()
  // How many getDbEndpoint polls before "available" (small so tests are fast).
  constructor(private availableAfterPolls = 2) {}

  async ensureParamGroup(paramGroup: string, _maxConnections: number): Promise<void> {
    this.paramGroups.add(paramGroup) // idempotent
  }

  async createDbInstance(args: CreateDbInstanceArgs): Promise<{ dbInstanceId: string }> {
    if (!this.endpoints.has(args.dbInstanceId) && !this.pending.has(args.dbInstanceId)) {
      this.pending.set(args.dbInstanceId, this.availableAfterPolls)
    }
    return { dbInstanceId: args.dbInstanceId }
  }

  async getDbEndpoint(dbInstanceId: string): Promise<string | null> {
    if (this.endpoints.has(dbInstanceId)) return this.endpoints.get(dbInstanceId)!
    const left = this.pending.get(dbInstanceId)
    if (left === undefined) return null
    if (left <= 0) {
      const ep = `${dbInstanceId}.stub.us-east-1.rds.amazonaws.com`
      this.endpoints.set(dbInstanceId, ep)
      this.pending.delete(dbInstanceId)
      return ep
    }
    this.pending.set(dbInstanceId, left - 1)
    return null // still provisioning
  }

  async loadSchema(_endpoint: string, _dbName: string): Promise<void> { /* no-op in stub */ }

  async ensureBucket(bucket: string): Promise<void> { this.buckets.add(bucket) }

  async stopDbInstance(dbInstanceId: string): Promise<void> { this.stopped.add(dbInstanceId) }
  async startDbInstance(dbInstanceId: string): Promise<void> { this.stopped.delete(dbInstanceId) }

  async deleteDbInstance(dbInstanceId: string): Promise<void> {
    this.endpoints.delete(dbInstanceId); this.pending.delete(dbInstanceId); this.stopped.delete(dbInstanceId)
  }
  async deleteBucket(bucket: string): Promise<void> { this.buckets.delete(bucket) }

  // test helpers
  isStopped(id: string) { return this.stopped.has(id) }
  hasBucket(b: string) { return this.buckets.has(b) }
}
