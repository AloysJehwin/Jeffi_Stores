import { AsyncLocalStorage } from 'async_hooks'

interface AuditContext {
  adminId: string | null
  /** Who made a change when it isn't an admin: 'razorpay', 'delhivery', 'cron', 'customer:<id>'. */
  actor?: string | null
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

export function getCurrentAuditActor(): string | null {
  return auditStore.getStore()?.actor ?? null
}

export function runWithAuditContext<T>(adminId: string | null, fn: () => Promise<T>): Promise<T> {
  return auditStore.run({ adminId }, fn)
}

/** Runs fn with its writes recorded as made by `actor` (webhooks, courier syncs). */
export function runWithAuditActor<T>(actor: string, fn: () => Promise<T>): Promise<T> {
  return auditStore.run({ adminId: getCurrentAuditAdminId(), actor }, fn)
}
