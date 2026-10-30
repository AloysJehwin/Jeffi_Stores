import { escapeLike, type FieldKeys, type FieldSql, type FilterEntity } from '@jeffi/list-filters'
import { WALLET_FIELDS } from '../fields/wallet'

// This store's wallet ledger, in the control-plane DB (wallet_ledger wl). The tenant id comes from
// the request (context) and is bound in `boundBase`; without one nothing matches.

type WalletKey = FieldKeys<typeof WALLET_FIELDS>

const IST = (col: string) => `to_char(${col} AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI')`

const SQL: Record<WalletKey, FieldSql> = {
  direction: { kind: 'enum', virtual: { in: 'wl.amount >= 0', out: 'wl.amount < 0' } },
  category: { kind: 'values', expr: 'COALESCE(wl.category, wl.entry_type)' },
  date: { kind: 'date', expr: 'wl.occurred_at' },
  amount: { kind: 'range', expr: 'abs(wl.amount)' },
  reference: { kind: 'values', array: 'ARRAY[wl.order_ref, wl.awb]' },
}

export const WALLET_ENTITY: FilterEntity<WalletKey> = {
  key: 'wallet',
  scope: 'delhivery:read',
  noun: 'Entries',
  db: 'control',
  root: 'wallet_ledger',
  alias: 'wl',
  boundBase: [(ctx, bind) => (typeof ctx.tenantId === 'string' && ctx.tenantId ? `wl.tenant_id = ${bind(ctx.tenantId)}::uuid` : 'FALSE')],
  context: async () => {
    const { resolveTenantId } = await import('@/lib/tenancy/tenant-context')
    return { tenantId: await resolveTenantId().catch(() => null) }
  },
  fields: WALLET_FIELDS,
  sql: SQL,
  period: 'date',
  search: {
    build: (q, idx) => ({
      clause: `(wl.order_ref ILIKE $${idx} OR wl.awb ILIKE $${idx} OR wl.note ILIKE $${idx})`,
      params: [`%${escapeLike(q.trim())}%`],
      nextIdx: idx + 1,
    }),
  },
  facets: true,
  export: {
    columns: [
      { key: 'occurred_at', label: 'Date', sql: IST('wl.occurred_at') },
      { key: 'category', label: 'Category', sql: 'COALESCE(wl.category, wl.entry_type)' },
      { key: 'direction', label: 'Direction', sql: "CASE WHEN wl.amount >= 0 THEN 'in' ELSE 'out' END" },
      { key: 'amount', label: 'Amount (INR)', sql: 'round(wl.amount, 2)' },
      { key: 'order_ref', label: 'Order', sql: 'wl.order_ref' },
      { key: 'awb', label: 'AWB', sql: 'wl.awb' },
      { key: 'note', label: 'Note', sql: "regexp_replace(COALESCE(wl.note, ''), '\\s+', ' ', 'g')" },
    ],
    keyset: ['wl.occurred_at', 'wl.id'],
  },
}
