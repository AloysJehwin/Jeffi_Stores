import 'server-only'
import { controlPlanePool } from '@/lib/tenant-registry'
import { debitWallet, isFlagshipTenant } from '@/lib/payments/wallet'
import { computeSpecEnabled } from '@controller/lib/compute/catalog'
import { pausedRateFor } from '@controller/lib/compute/resolve'
import { getTenantCompute } from '@controller/lib/compute/store'

// A store's servers are paid from its wallet. What it pays per hour is kept as periods
// (tenant_compute_periods, a new one at each resize, pause or resume), and each IST day is charged the day
// after, even into a negative balance: the servers ran. infra-balance.ts then warns, pauses and resumes.
// Only while owners choose their servers (COMPUTE_SPEC_ENABLED); the flagship pays nothing.

const DAY_MS = 86_400_000
const CATCH_UP_DAYS = 3 // a missed run is caught up; the debit's external ref keeps each day charged once

/** Start a new period when what the store pays per hour changes; close it when the store stops being billed. */
export async function syncComputePeriod(tenantId: string): Promise<void> {
  if (!computeSpecEnabled() || isFlagshipTenant(tenantId)) return
  const [row, t] = await Promise.all([
    getTenantCompute(tenantId),
    controlPlanePool().query<{ status: string }>(`SELECT status FROM tenants WHERE id = $1`, [tenantId]),
  ])
  const billed = !!row?.applied && row.rate_inr_hour != null && t.rows[0]?.status === 'active'
  const rate = billed ? Number(row!.rate_inr_hour) : null
  const storage = billed ? ((await pausedRateFor(row!.applied!)) ?? 0) : null
  const paused = row?.status === 'paused'
  const client = await controlPlanePool().connect()
  try {
    await client.query('BEGIN')
    const open = await client.query(
      `SELECT id, rate_inr_hour, storage_inr_hour, paused FROM tenant_compute_periods WHERE tenant_id = $1 AND ended_at IS NULL FOR UPDATE`,
      [tenantId]
    )
    const o = open.rows[0]
    const same = o && rate != null && Number(o.rate_inr_hour) === rate && Number(o.storage_inr_hour) === storage && o.paused === paused
    if (!same) {
      if (o) await client.query(`UPDATE tenant_compute_periods SET ended_at = now() WHERE id = $1`, [o.id])
      if (rate != null) {
        await client.query(
          `INSERT INTO tenant_compute_periods (tenant_id, rate_inr_hour, storage_inr_hour, paused) VALUES ($1, $2, $3, $4)`,
          [tenantId, rate, storage, paused]
        )
      }
    }
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

/** Midnight IST that starts the day `d` falls in. */
export function istDayStart(d: Date): Date {
  const ist = new Date(d.getTime() + 5.5 * 3600_000)
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - 5.5 * 3600_000)
}
const istDate = (start: Date) => new Date(start.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10)

export interface DayCharge {
  tenantId: string
  day: string
  hours: number
  amountInr: number
  charged: boolean
  error?: string
}

/** Charge one IST day (it must be over) to every store that had a price during it. */
export async function chargeDay(start: Date): Promise<DayCharge[]> {
  const end = new Date(start.getTime() + DAY_MS)
  const day = istDate(start)
  const r = await controlPlanePool().query<{ tenant_id: string; hours: string; inr: string }>(
    `SELECT tenant_id,
            SUM(EXTRACT(EPOCH FROM LEAST(COALESCE(ended_at, $2), $2) - GREATEST(started_at, $1)) / 3600) AS hours,
            SUM(EXTRACT(EPOCH FROM LEAST(COALESCE(ended_at, $2), $2) - GREATEST(started_at, $1)) / 3600
                * CASE WHEN paused THEN storage_inr_hour ELSE rate_inr_hour END) AS inr
       FROM tenant_compute_periods
      WHERE started_at < $2 AND COALESCE(ended_at, $2) > $1
      GROUP BY tenant_id`,
    [start, end]
  )
  const out: DayCharge[] = []
  for (const row of r.rows) {
    const hours = Math.round(Number(row.hours) * 100) / 100
    const amountInr = Math.round(Number(row.inr) * 100) / 100
    if (!(amountInr > 0)) continue
    const label = start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })
    const res = await debitWallet({
      tenantId: row.tenant_id,
      amountInr,
      category: 'infra',
      externalRef: `infra:${row.tenant_id}:${day}`,
      note: `Servers, ${label} (${hours} h)`,
      floorInr: 0,
      allowNegative: true,
    })
    out.push({ tenantId: row.tenant_id, day, hours, amountInr, charged: res.ok && res.charged, ...(!res.ok && { error: res.error }) })
  }
  return out
}

/** The daily run: bring every store's period up to date, then charge the days that are over and not yet charged. */
export async function chargeInfra(now = new Date()): Promise<DayCharge[]> {
  if (!computeSpecEnabled()) return []
  const stores = await controlPlanePool().query<{ tenant_id: string }>(
    `SELECT c.tenant_id FROM tenant_compute c
      UNION SELECT tenant_id FROM tenant_compute_periods WHERE ended_at IS NULL`
  )
  for (const { tenant_id } of stores.rows) {
    await syncComputePeriod(tenant_id).catch(e => console.error(`[infra-billing] ${tenant_id}: period not synced: ${e?.message}`))
  }
  const today = istDayStart(now)
  const charges: DayCharge[] = []
  for (let i = CATCH_UP_DAYS; i >= 1; i--) charges.push(...(await chargeDay(new Date(today.getTime() - i * DAY_MS))))
  return charges
}
