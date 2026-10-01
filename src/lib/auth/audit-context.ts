import { AsyncLocalStorage } from 'async_hooks'

interface AuditContext {
  adminId: string | null
}

const auditStore = new AsyncLocalStorage<AuditContext>()

export function setAuditAdminId(adminId: string | null): void {
  const existing = auditStore.getStore()
  if (existing) {
    existing.adminId = adminId
  } else {
    auditStore.enterWith({ adminId })
  }
}

export function getCurrentAuditAdminId(): string | null {
  return auditStore.getStore()?.adminId ?? null
}

export function runWithAuditContext<T>(adminId: string | null, fn: () => Promise<T>): Promise<T> {
  return auditStore.run({ adminId }, fn)
}
