import { BULK_MAX, BULK_OPERATIONS } from '@/lib/admin-agent/tools/controls'
import { callInternalApi, type AgentAction, type ActionResult } from './shared'

// Approved bulk changes go through the Controls page's own endpoints with the approving admin's session,
// so the same scope (controls:write), value checks, before-snapshot and operation log apply as for a
// click on that page, and the change can be undone from Controls → History.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const failure = (r: { status: number; data: any }) =>
  (r.data && typeof r.data === 'object' && r.data.error) ||
  (typeof r.data === 'string' && r.data.trim()) ||
  `Request failed (${r.status})`

const plural = (n: number) => `${n} product${n === 1 ? '' : 's'}`

export async function bulkUpdateProducts(action: AgentAction, cookieHeader: string): Promise<ActionResult> {
  const p = action.payload ?? {}
  if (typeof p.operation !== 'string' || !Object.hasOwn(BULK_OPERATIONS, p.operation)) {
    return { result: null, error: 'Unsupported Controls operation' }
  }
  const ids: unknown[] = Array.isArray(p.productIds) ? p.productIds : []
  if (!ids.length || ids.length > BULK_MAX || !ids.every(id => typeof id === 'string' && UUID_RE.test(id))) {
    return { result: null, error: 'Invalid product list' }
  }
  if (p.value == null || p.value === '') return { result: null, error: 'value missing' }
  // The body the Controls page sends.
  const r = await callInternalApi(cookieHeader, 'POST', '/api/admin/controls', {
    operation: p.operation,
    value: p.value,
    product_ids: ids,
    inherit_to_variants: p.inheritToVariants !== false,
  })
  if (!r.ok) return { result: null, error: failure(r) }
  const updated = Number(r.data?.updated ?? 0)
  const label = `${p.operationLabel ?? p.operation}${p.valueLabel ? `: ${p.valueLabel}` : ''}`
  return {
    result: {
      summary: `${label} applied to ${plural(updated)}. Undo from Controls → History.`,
      updated,
      productCount: ids.length,
      logId: r.data?.log_id ?? null,
      href: '/admin/controls',
    },
    error: null,
  }
}

export async function rollbackBulkUpdate(action: AgentAction, cookieHeader: string): Promise<ActionResult> {
  const p = action.payload ?? {}
  if (typeof p.logId !== 'string' || !UUID_RE.test(p.logId)) return { result: null, error: 'logId missing' }
  if (Number(p.productCount) > BULK_MAX) return { result: null, error: `More than ${BULK_MAX} products: undo it in Controls → History` }
  const r = await callInternalApi(cookieHeader, 'POST', '/api/admin/controls/rollback', { log_id: p.logId })
  if (!r.ok) return { result: null, error: failure(r) }
  const restored = Number(r.data?.restored ?? 0)
  const label = `${p.operationLabel ?? p.operation ?? 'operation'}${p.valueLabel ? `: ${p.valueLabel}` : ''}`
  return {
    result: { summary: `Rolled back "${label}": ${plural(restored)} restored.`, restored, logId: p.logId, href: '/admin/controls' },
    error: null,
  }
}
