import { AsyncLocalStorage } from 'node:async_hooks'

export interface TenantInfra {
  rdsEndpoint: string | null
  rdsDb: string
  rdsPort: number
  dbSecretRef: string | null
  iamAuth: boolean
  s3Bucket: string | null
  region: string
}

export interface TenantContext {
  tenantId: string
  slug: string
  displayName: string | null
  plan: string | null
  infra: TenantInfra | null
}

export interface RequestScope {
  /** null = the platform's own store (flagship), whose rows live in the main app DB. */
  tenant: TenantContext | null
  adminId?: string | null
}

const als = new AsyncLocalStorage<RequestScope>()

export function runWithTenant<T>(tenant: TenantContext, fn: () => Promise<T>, adminId?: string | null): Promise<T> {
  return als.run({ tenant, adminId: adminId ?? null }, fn)
}

export function runAsPlatform<T>(fn: () => Promise<T>, adminId?: string | null): Promise<T> {
  return als.run({ tenant: null, adminId: adminId ?? null }, fn)
}

export function isPlatformScope(): boolean {
  const s = als.getStore()
  return !!s && !s.tenant
}

export function currentScope(): RequestScope | null {
  return als.getStore() ?? null
}

export function currentTenant(): TenantContext | null {
  return als.getStore()?.tenant ?? null
}

export function requireTenant(): TenantContext {
  const t = currentTenant()
  if (!t) throw new Error('No tenant in scope')
  return t
}

export function currentAdminId(): string | null {
  return als.getStore()?.adminId ?? null
}
