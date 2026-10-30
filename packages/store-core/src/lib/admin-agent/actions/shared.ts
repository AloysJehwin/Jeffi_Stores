import { AsyncLocalStorage } from 'node:async_hooks'

export const APPROVE_ORIGIN = process.env.NEXT_PUBLIC_SITE_URL || `http://localhost:${process.env.PORT || 3000}`

const SELF_BASE = process.env.CRON_SELF_BASE || `http://127.0.0.1:${process.env.PORT || '3000'}`
const ROOT_DOMAIN = process.env.PLATFORM_ROOT_DOMAIN || 'jeffistores.in'

// Where an approved action's API calls go. A store's calls go to this process with the store's host,
// so middleware runs them in that store's DB; without a target they run as the platform store.
export interface ApproveTarget {
  origin: string
  host: string | null
  userAgent?: string
}

const targetStore = new AsyncLocalStorage<ApproveTarget>()

export function storeTarget(slug: string | null | undefined, userAgent?: string): ApproveTarget | null {
  return slug ? { origin: SELF_BASE, host: `${slug}.${ROOT_DOMAIN}`, userAgent } : userAgent ? { origin: APPROVE_ORIGIN, host: null, userAgent } : null
}

export function withApproveTarget<T>(target: ApproveTarget | null, fn: () => Promise<T>): Promise<T> {
  return target ? targetStore.run(target, fn) : fn()
}

/** fetch() against this app, as the store set by withApproveTarget. */
export function internalFetch(path: string, init: { method: string; headers?: Record<string, string>; body?: string }) {
  const t = targetStore.getStore()
  const headers: Record<string, string> = { ...init.headers }
  if (t?.host) headers.Host = t.host
  if (t?.userAgent) headers['User-Agent'] = t.userAgent
  return fetch(new URL(path, t?.origin ?? APPROVE_ORIGIN).toString(), { ...init, headers })
}

export interface AgentAction {
  id: string
  admin_id: string
  conversation_id: string
  kind: string
  payload: any
  status: string
}

export type ActionResult = { result: any; error: string | null }

export type ActionHandler = (action: AgentAction, cookieHeader: string) => Promise<ActionResult>

export async function callInternalApi(
  cookieHeader: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown
): Promise<{ status: number; ok: boolean; data: any }> {
  const res = await internalFetch(path, {
    method,
    headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let data: any
  try {
    data = await res.json()
  } catch {
    data = await res.text().catch(() => null)
  }
  return { status: res.status, ok: res.ok, data }
}
