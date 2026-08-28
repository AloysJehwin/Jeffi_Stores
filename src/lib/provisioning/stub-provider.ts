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
  private backups = new Map<string, Buffer>()   // endpoint -> last dumped archive
  private restored = new Map<string, Buffer>()   // endpoint -> last restored archive
  private dns = new Set<string>()                 // tenant hostnames pointed at the app
  private instances = new Map<string, string>()   // instanceId -> public IP (EC2 app instances)
  private instanceSeq = 0
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

  async backupDb(endpoint: string, _dbName: string): Promise<Buffer> {
    // Deterministic fake archive so callers get real bytes to round-trip through S3.
    const buf = Buffer.from(JSON.stringify({ stub: true, endpoint }), 'utf8')
    this.backups.set(endpoint, buf)
    return buf
  }

  async restoreDb(endpoint: string, _dbName: string, archive: Buffer): Promise<void> {
    this.restored.set(endpoint, archive)
  }

  async ensureBucket(bucket: string): Promise<void> { this.buckets.add(bucket) }

  async ensureDns(hostnames: string[], _targetIp?: string): Promise<void> { hostnames.forEach((h) => this.dns.add(h)) }
  async removeDns(hostnames: string[]): Promise<void> { hostnames.forEach((h) => this.dns.delete(h)) }

  async stopDbInstance(dbInstanceId: string): Promise<void> { this.stopped.add(dbInstanceId) }
  async startDbInstance(dbInstanceId: string): Promise<void> { this.stopped.delete(dbInstanceId) }

  async deleteDbInstance(dbInstanceId: string): Promise<void> {
    this.endpoints.delete(dbInstanceId); this.pending.delete(dbInstanceId); this.stopped.delete(dbInstanceId)
  }
  async deleteBucket(bucket: string): Promise<void> { this.buckets.delete(bucket) }

  async isDbInstanceGone(dbInstanceId: string): Promise<boolean> {
    return !this.endpoints.has(dbInstanceId) && !this.pending.has(dbInstanceId)
  }
  async deleteParamGroup(paramGroup: string): Promise<void> { this.paramGroups.delete(paramGroup) }

  async ensureAppInstance(
    args: { name: string; instanceType: string; userData?: string },
    onLaunched?: (instanceId: string) => Promise<void>,
  ): Promise<{ instanceId: string; ip: string }> {
    const instanceId = `i-stub${String(++this.instanceSeq).padStart(6, '0')}`
    const ip = `52.0.0.${this.instanceSeq}`
    this.instances.set(instanceId, ip)
    if (onLaunched) await onLaunched(instanceId)
    return { instanceId, ip }
  }
  async deleteAppInstance(instanceId: string): Promise<void> { this.instances.delete(instanceId) }
  async isInstanceGone(instanceId: string): Promise<boolean> { return !this.instances.has(instanceId) }

  // test helpers
  isStopped(id: string) { return this.stopped.has(id) }
  hasBucket(b: string) { return this.buckets.has(b) }
  hasParamGroup(pg: string) { return this.paramGroups.has(pg) }
  wasBackedUp(endpoint: string) { return this.backups.has(endpoint) }
  wasRestored(endpoint: string) { return this.restored.has(endpoint) }
  hasDns(host: string) { return this.dns.has(host) }
  hasInstance(id: string) { return this.instances.has(id) }
  instanceCount() { return this.instances.size }
}
