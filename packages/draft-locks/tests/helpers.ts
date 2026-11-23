import { vi } from 'vitest'
import type { SqlClient } from '../src/locks'

export interface Call {
  text: string
  params: unknown[]
}

export type Reply = { rows?: any[]; rowCount?: number | null } | ((call: Call) => { rows?: any[]; rowCount?: number | null })

/**
 * Fake SqlClient driven by ordered matchers. Each matcher is a substring (or regex)
 * matched against the SQL text; the first matcher whose `times` budget is not spent
 * handles the call. Records every call for assertions.
 */
export class FakeClient implements SqlClient {
  calls: Call[] = []
  private matchers: { frag: string | RegExp; reply: Reply; times: number }[] = []

  on(frag: string | RegExp, reply: Reply, times = Infinity): this {
    this.matchers.push({ frag, reply, times })
    return this
  }

  query = vi.fn(async (text: string, params: unknown[] = []) => {
    const call = { text, params }
    this.calls.push(call)
    for (const m of this.matchers) {
      if (m.times <= 0) continue
      const hit = typeof m.frag === 'string' ? text.includes(m.frag) : m.frag.test(text)
      if (!hit) continue
      m.times -= 1
      const r = typeof m.reply === 'function' ? m.reply(call) : m.reply
      return { rows: r.rows ?? [], rowCount: r.rowCount === undefined ? (r.rows?.length ?? 0) : r.rowCount }
    }
    return { rows: [], rowCount: 0 }
  })

  /** All calls whose SQL includes `frag`. */
  matching(frag: string): Call[] {
    return this.calls.filter(c => c.text.includes(frag))
  }
  first(frag: string): Call | undefined {
    return this.calls.find(c => c.text.includes(frag))
  }
}

/** A draft_locks DB row, with sensible defaults; override per test. */
export function lockRow(over: Record<string, any> = {}): Record<string, any> {
  return {
    resource_type: 'product',
    resource_id: 'res-1',
    owner_admin_id: 'admin-1',
    owner_name: 'Owner One',
    owner_active: true,
    owner_role: 'administrator',
    owner_scopes: [],
    started_by_admin_id: 'admin-1',
    previous_owner_admin_id: null,
    previous_owner_name: null,
    acquired_via: 'start',
    takeover_reason: null,
    epoch: 1,
    started_at: '2026-01-01T00:00:00.000Z',
    acquired_at: '2026-01-01T00:00:00.000Z',
    last_active_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    closed_at: null,
    closed_reason: null,
    closed_by_admin_id: null,
    closed_by_name: null,
    ...over,
  }
}
