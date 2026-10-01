export const APPROVE_ORIGIN = process.env.NEXT_PUBLIC_SITE_URL || `http://localhost:${process.env.PORT || 3000}`

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
  const res = await fetch(new URL(path, APPROVE_ORIGIN).toString(), {
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
