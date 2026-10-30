import 'server-only'
import { query, queryMany, queryOne } from '@/lib/shared/db'
import { getRazorpayInstanceFor } from '@/lib/payments/razorpay'
import { controlPlanePool } from '@/lib/tenant-registry'
import { withChannelLock, type RunResult } from '@/lib/channels/sync-run'
import { razorpayAccountFor } from './rzp-account'

/**
 * Pulls this store's Razorpay settlements (bank payouts) and their report lines, and matches each line
 * to what it paid for: an order here, another store's sale (the flagship's platform account collects
 * for Route stores), platform billing, or an adjustment. Route stores have no settlements of their own.
 */

const STATE_KEY = 'razorpay_settlement_sync'
const BACKFILL_DAYS = 92
const UUID = `'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`
const BILLING_PURPOSES = `('wallet_topup','plan','billing')`

interface SyncState {
  backfilled?: boolean
  last_run_at?: string
}

const inr = (p: unknown) => (Number(p) || 0) / 100
const at = (unix: unknown) => (Number(unix) > 0 ? new Date(Number(unix) * 1000).toISOString() : null)

/** Calendar parts of a moment in India, where Razorpay's report days are cut. */
const ist = (d: Date) => {
  const x = new Date(d.getTime() + 330 * 60000)
  return { year: x.getUTCFullYear(), month: x.getUTCMonth() + 1, day: x.getUTCDate() }
}
const istStart = (year: number, month: number, day = 1) => Math.floor((Date.UTC(year, month - 1, day) - 330 * 60000) / 1000)

type Window = { year: number; month: number; day?: number }[]

function windowFor(state: SyncState, opts: { day?: Date; full?: boolean }): Window {
  if (opts.day) return [ist(opts.day)]
  const now = new Date()
  const months: Window = []
  const add = (d: Date) => {
    const { year, month } = ist(d)
    if (!months.some(m => m.year === year && m.month === month)) months.push({ year, month })
  }
  if (opts.full || !state.backfilled) {
    for (let back = BACKFILL_DAYS; back >= 0; back -= 7) add(new Date(now.getTime() - back * 86400000))
    add(now)
    return months
  }
  const stale = !state.last_run_at || Date.now() - new Date(state.last_run_at).getTime() > 7 * 86400000
  if (ist(now).day <= 7 || stale) add(new Date(now.getTime() - 8 * 86400000))
  add(now)
  return months
}

async function readState(): Promise<SyncState> {
  const row = await queryOne<{ value: string }>(`SELECT value FROM site_settings WHERE key = $1`, [STATE_KEY]).catch(() => null)
  try {
    return row?.value ? JSON.parse(row.value) : {}
  } catch {
    return {}
  }
}

async function writeState(s: SyncState) {
  await query(`INSERT INTO site_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [
    STATE_KEY,
    JSON.stringify(s),
  ])
}

export async function lastSettlementSync(): Promise<SyncState> {
  return readState()
}

function toLine(it: any) {
  return {
    settlement_id: it.settlement_id,
    entity_id: it.entity_id,
    type: String(it.type || 'unknown'),
    amount: inr(it.amount),
    credit: inr(it.credit),
    debit: inr(it.debit),
    fee: inr(it.fee),
    tax: inr(it.tax),
    on_hold: !!it.on_hold,
    method: it.method || null,
    card_network: it.card_network || null,
    card_type: it.card_type || null,
    payment_id: it.payment_id || (it.type === 'payment' ? it.entity_id : null),
    rzp_order_id: it.order_id || null,
    order_receipt: it.order_receipt || null,
    dispute_id: it.dispute_id || null,
    description: it.description || null,
    notes: it.notes && typeof it.notes === 'object' && !Array.isArray(it.notes) ? it.notes : null,
    entity_created_at: at(it.created_at),
    settled_at: at(it.settled_at),
  }
}

const LINE_COLS = `settlement_id text, entity_id text, type text, amount numeric, credit numeric, debit numeric, fee numeric, tax numeric,
  on_hold boolean, method text, card_network text, card_type text, payment_id text, rzp_order_id text, order_receipt text,
  dispute_id text, description text, notes jsonb, entity_created_at timestamptz, settled_at timestamptz`

async function upsertLines(lines: ReturnType<typeof toLine>[]) {
  for (let i = 0; i < lines.length; i += 500) {
    // Re-syncs refresh Razorpay's columns and keep what each line was matched to.
    await query(
      `INSERT INTO razorpay_settlement_items (settlement_id, entity_id, type, amount, credit, debit, fee, tax, on_hold, method, card_network,
         card_type, payment_id, rzp_order_id, order_receipt, dispute_id, description, notes, entity_created_at, settled_at)
       SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(${LINE_COLS})
       ON CONFLICT (settlement_id, entity_id) DO UPDATE SET
         type = EXCLUDED.type, amount = EXCLUDED.amount, credit = EXCLUDED.credit, debit = EXCLUDED.debit, fee = EXCLUDED.fee,
         tax = EXCLUDED.tax, on_hold = EXCLUDED.on_hold, method = EXCLUDED.method, card_network = EXCLUDED.card_network,
         card_type = EXCLUDED.card_type, payment_id = EXCLUDED.payment_id, rzp_order_id = EXCLUDED.rzp_order_id,
         order_receipt = EXCLUDED.order_receipt, dispute_id = EXCLUDED.dispute_id, description = EXCLUDED.description,
         notes = EXCLUDED.notes, entity_created_at = EXCLUDED.entity_created_at, settled_at = EXCLUDED.settled_at, synced_at = NOW()`,
      [JSON.stringify(lines.slice(i, i + 500))]
    )
  }
}

async function upsertHeader(s: any, account: 'platform' | 'own', keyId: string | null) {
  await query(
    `INSERT INTO razorpay_settlements (id, account, key_id, amount, fees, tax, utr, status, settled_at, raw)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (id) DO UPDATE SET amount = EXCLUDED.amount, fees = EXCLUDED.fees, tax = EXCLUDED.tax,
       utr = COALESCE(EXCLUDED.utr, razorpay_settlements.utr), status = EXCLUDED.status,
       settled_at = COALESCE(EXCLUDED.settled_at, razorpay_settlements.settled_at), raw = EXCLUDED.raw, synced_at = NOW()`,
    [s.id, account, keyId, inr(s.amount), inr(s.fees), inr(s.tax), s.utr || null, s.status || null, at(s.processed_at ?? s.created_at), JSON.stringify(s)]
  )
}

/** Matches the touched settlements' unmatched lines. Returns how many lines it matched. */
async function matchLines(ids: string[], flagship: boolean): Promise<number> {
  let matched = 0
  const run = async (sql: string, params: any[] = []) => {
    const r = await query(sql, [ids, ...params])
    matched += r.rowCount ?? 0
  }
  const unmatched = `i.settlement_id = ANY($1) AND i.scope = 'unmatched'`

  // A payment, or a refund of one, recorded here.
  await run(
    `UPDATE razorpay_settlement_items i SET scope = 'order', local_payment_id = p.id, order_id = p.order_id, order_number = o.order_number
       FROM payments p JOIN orders o ON o.id = p.order_id
      WHERE ${unmatched} AND i.payment_id IS NOT NULL AND p.transaction_id = i.payment_id`
  )
  await run(
    `UPDATE razorpay_settlement_items i SET scope = 'order', local_payment_id = p.id, order_id = p.order_id, order_number = o.order_number
       FROM payments p JOIN orders o ON o.id = p.order_id
      WHERE ${unmatched} AND i.rzp_order_id IS NOT NULL AND p.gateway_response->>'razorpay_order_id' = i.rzp_order_id`
  )
  // Older QR and link payments were stored under their qr_/plink_ id; their notes name the order.
  await run(
    `UPDATE razorpay_settlement_items i SET scope = 'order', order_id = o.id, order_number = o.order_number
       FROM orders o
      WHERE ${unmatched} AND o.id = CASE WHEN i.notes->>'order_id' ~* ${UUID} THEN (i.notes->>'order_id')::uuid END`
  )

  if (flagship) matched += await matchOtherStores(ids)

  await run(
    `UPDATE razorpay_settlement_items i SET scope = 'platform_billing'
      WHERE ${unmatched} AND i.notes->>'purpose' IN ${BILLING_PURPOSES}`
  )
  await run(`UPDATE razorpay_settlement_items i SET scope = 'adjustment' WHERE ${unmatched} AND i.type NOT IN ('payment', 'refund', 'transfer')`)
  return matched
}

/** The platform account also collects Route stores' sales and pays them out by transfer. */
async function matchOtherStores(ids: string[]): Promise<number> {
  const lines = await queryMany<{ entity_id: string; settlement_id: string; payment_id: string | null; type: string }>(
    `SELECT entity_id, settlement_id, payment_id, type FROM razorpay_settlement_items
      WHERE settlement_id = ANY($1) AND scope = 'unmatched' AND COALESCE(notes->>'purpose', '') NOT IN ${BILLING_PURPOSES}`,
    [ids]
  )
  if (!lines.length) return 0
  const payIds = [...new Set(lines.map(l => l.payment_id).filter(Boolean))] as string[]
  const trfIds = lines.filter(l => l.type === 'transfer').map(l => l.entity_id)
  const found = await controlPlanePool()
    .query<{ payment_id: string | null; transfer_id: string | null; tenant_id: string; order_ref: string | null; slug: string | null }>(
      `SELECT t.payment_id, t.transfer_id, t.tenant_id, t.order_ref, n.slug
         FROM tenant_transactions t JOIN tenants n ON n.id = t.tenant_id
        WHERE t.payment_id = ANY($1) OR t.transfer_id = ANY($2)`,
      [payIds, trfIds]
    )
    .then(r => r.rows)
    .catch(() => [])
  const byPay = new Map(found.filter(f => f.payment_id).map(f => [f.payment_id!, f]))
  const byTrf = new Map(found.filter(f => f.transfer_id).map(f => [f.transfer_id!, f]))
  const hits = lines
    .map(l => {
      const f = (l.type === 'transfer' ? byTrf.get(l.entity_id) : undefined) ?? (l.payment_id ? byPay.get(l.payment_id) : undefined)
      return f && { settlement_id: l.settlement_id, entity_id: l.entity_id, tenant_id: f.tenant_id, slug: f.slug, order_ref: f.order_ref }
    })
    .filter(Boolean)
  let n = 0
  if (hits.length) {
    const r = await query(
      `UPDATE razorpay_settlement_items i SET scope = 'other_store', source_tenant_id = x.tenant_id, source_tenant_slug = x.slug, source_order_ref = x.order_ref
         FROM jsonb_to_recordset($1::jsonb) AS x(settlement_id text, entity_id text, tenant_id uuid, slug text, order_ref text)
        WHERE i.settlement_id = x.settlement_id AND i.entity_id = x.entity_id`,
      [JSON.stringify(hits)]
    )
    n += r.rowCount ?? 0
  }
  // Not in the ledger (an own-key store's money never is): the notes still name the store.
  const r = await query(
    `UPDATE razorpay_settlement_items i SET scope = 'other_store',
            source_tenant_id = CASE WHEN i.notes->>'tenant_id' ~* ${UUID} THEN (i.notes->>'tenant_id')::uuid END,
            source_tenant_slug = NULLIF(i.notes->>'tenant_slug', ''),
            source_order_ref = COALESCE(i.notes->>'order_number', i.order_receipt)
      WHERE i.settlement_id = ANY($1) AND i.scope = 'unmatched'
        AND COALESCE(i.notes->>'purpose', '') NOT IN ${BILLING_PURPOSES}
        AND (COALESCE(i.notes->>'tenant_id', '') <> '' OR COALESCE(i.notes->>'tenant_slug', '') <> '')`,
    [ids]
  )
  return n + (r.rowCount ?? 0)
}

export class RazorpaySettlementsUnavailable extends Error {}

/**
 * Syncs settlements: the first run backfills three months, later runs this month (and last month in
 * its first week or when a run was missed); `day` syncs one day, for the settlement webhook.
 */
export async function syncRazorpaySettlements(opts: { day?: Date; full?: boolean } = {}): Promise<RunResult> {
  const account = await razorpayAccountFor()
  if (account.kind === 'route') throw new RazorpaySettlementsUnavailable('This store is paid out through Route, not settlements.')
  const { instance, creds } = await getRazorpayInstanceFor(account.tenantId ?? undefined)
  const acct = account.kind === 'own' ? 'own' : 'platform'

  return withChannelLock('razorpay', 'razorpay_settlements', opts.day ? 'settlements_day' : 'settlements', async ctx => {
    const state = await readState()
    const win = windowFor(state, opts)
    const touched = new Set<string>()

    for (const w of win) {
      await ctx.step('lines', async () => {
        let n = 0
        for (let skip = 0; skip < 100_000; skip += 1000) {
          const page: any = await instance.settlements.reports({ year: w.year, month: w.month, ...(w.day ? { day: w.day } : {}), count: 1000, skip })
          const items: any[] = Array.isArray(page?.items) ? page.items : []
          const lines = items.filter(it => it?.settlement_id && it?.entity_id && it.settled !== false).map(toLine)
          lines.forEach(l => touched.add(l.settlement_id))
          await upsertLines(lines)
          n += lines.length
          if (items.length < 1000) break
        }
        return n
      })
    }

    await ctx.step('settlements', async () => {
      const first = win[0]
      const last = win[win.length - 1]
      const from = istStart(first.year, first.month, first.day ?? 1)
      const to = last.day ? istStart(last.year, last.month, last.day) + 2 * 86400 : Math.floor(Date.now() / 1000)
      let n = 0
      for (let skip = 0; skip < 5000; skip += 100) {
        const page: any = await instance.settlements.all({ from, to, count: 100, skip })
        const items: any[] = Array.isArray(page?.items) ? page.items : []
        for (const s of items) {
          await upsertHeader(s, acct, creds.key_id ?? null)
          touched.add(s.id)
          n++
        }
        if (items.length < 100) break
      }
      // Lines whose settlement fell outside the header window.
      const missing = await queryMany<{ settlement_id: string }>(
        `SELECT DISTINCT i.settlement_id FROM razorpay_settlement_items i
          WHERE i.settlement_id = ANY($1) AND NOT EXISTS (SELECT 1 FROM razorpay_settlements s WHERE s.id = i.settlement_id) LIMIT 50`,
        [[...touched]]
      )
      for (const m of missing) {
        const s = await instance.settlements.fetch(m.settlement_id).catch(() => null)
        if (s) {
          await upsertHeader(s, acct, creds.key_id ?? null)
          n++
        }
      }
      return n
    })

    const ids = [...touched]
    if (!ids.length) return
    await ctx.step('totals', async () => {
      await query(
        `UPDATE razorpay_settlements s SET item_count = x.n, lines_credit = x.c, lines_debit = x.d
           FROM (SELECT settlement_id, COUNT(*)::int AS n, SUM(credit) AS c, SUM(debit) AS d
                   FROM razorpay_settlement_items WHERE settlement_id = ANY($1) GROUP BY settlement_id) x
          WHERE s.id = x.settlement_id`,
        [ids]
      )
    })
    await ctx.step('matched', () => matchLines(ids, account.kind === 'platform'))
    // Razorpay's fee on a payment, where checkout didn't record it.
    await ctx.step('fees', async () => {
      const r = await query(
        `UPDATE payments p SET fee = i.fee, tax = i.tax, updated_at = NOW()
           FROM razorpay_settlement_items i
          WHERE i.settlement_id = ANY($1) AND i.type = 'payment' AND i.local_payment_id = p.id AND p.fee IS NULL`,
        [ids]
      )
      return r.rowCount ?? 0
    })
    if (!opts.day && !ctx.errors.length) await writeState({ backfilled: true, last_run_at: new Date().toISOString() })
  })
}
