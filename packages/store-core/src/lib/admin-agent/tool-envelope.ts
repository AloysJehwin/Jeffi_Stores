export type AgentToolMatchStatus = 'matched' | 'unmatched' | 'ambiguous'

export interface AgentToolDisplayHints {
  primaryField?: string
  hideFields?: string[]
  emptyMessage?: string
  itemNoun?: string
}

export interface AgentToolAction {
  kind: string
  payload: Record<string, unknown>
  confirmation: string
  reversible?: boolean
  reversal?: string
}

export interface AgentToolResultOk<TData = unknown> {
  ok: true
  summary: string
  data?: TData
  count?: number
  action?: AgentToolAction
  displayHints?: AgentToolDisplayHints
  meta?: Record<string, unknown>
  uiBlocks?: Record<string, unknown>[]
}

export interface AgentToolResultErr {
  ok: false
  summary: string
  reason?: string
  hint?: string
}

export type AgentToolResult<TData = unknown> = AgentToolResultOk<TData> | AgentToolResultErr

export function ok<TData>(input: Omit<AgentToolResultOk<TData>, 'ok'>): AgentToolResultOk<TData> {
  return { ok: true, ...input }
}

export function err(summary: string, reason?: string, hint?: string): AgentToolResultErr {
  return { ok: false, summary, ...(reason ? { reason } : {}), ...(hint ? { hint } : {}) }
}

const SENSITIVE_KEY_RE = /(password|secret|token|signature|hash|salt|reset_|otp|2fa)/i

export function stripSensitive<T>(row: T): T {
  if (!row || typeof row !== 'object') return row
  if (Array.isArray(row)) return (row as unknown[]).map(r => stripSensitive(r)) as unknown as T
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
    if (SENSITIVE_KEY_RE.test(k)) continue
    out[k] = stripSensitive(v as unknown)
  }
  return out as unknown as T
}

export function pick<T extends Record<string, unknown>, K extends keyof T>(row: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>
  for (const k of keys) {
    if (k in row) out[k] = row[k]
  }
  return out
}

export function pickAll<T extends Record<string, unknown>, K extends keyof T>(
  rows: T[],
  keys: readonly K[]
): Pick<T, K>[] {
  return rows.map(r => pick(r, keys))
}

export function isAgentToolResult(value: unknown): value is AgentToolResult {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.ok === 'boolean' && typeof v.summary === 'string'
}
