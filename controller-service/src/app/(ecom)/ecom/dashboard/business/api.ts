import type { KybView } from '@controller/lib/kyb/view'

export type KybResult = { ok: true; kyb: KybView } | { ok: false; status: number; error: string; fields: Record<string, string> }

/** Calls a KYB route. Each answers the business's KYB, or an error with the fields it is about. */
export async function kybCall(url: string, init?: RequestInit): Promise<KybResult> {
  const res = await fetch(url, { cache: 'no-store', ...init }).catch(() => null)
  const data = await res?.json().catch(() => null)
  if (res?.ok && data?.kyb) return { ok: true, kyb: data.kyb }
  const fields: Record<string, string> = { ...(data?.fields ?? {}) }
  // A locked field answers 409 with `field` (singular).
  if (data?.field && data?.error) fields[data.field] = data.error
  const error = !res
    ? 'Could not reach Jeffi. Check your connection and try again.'
    : data?.error && data.error !== 'Validation failed'
      ? String(data.error)
      : (Object.values(fields)[0] ?? 'Something went wrong. Try again.')
  return { ok: false, status: res?.status ?? 0, error, fields }
}

export const putKyb = (body: Record<string, unknown>) =>
  kybCall('/api/ecom/kyb', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
