import { db } from './db.js'
import { refreshUsdInr, setMessagePricing, type FxRate } from '@jeffi/pricing'

// The message pricing sheet the platform administrator edits (control-plane platform_infra 'message_pricing'),
// loaded into @jeffi/pricing so its price functions use it, plus the live USD→INR rate shared through
// platform_infra 'fx_usd_inr'. Cached a minute (the rate ten); a failed read keeps the last values.

let loadedAt = 0
let fxCheckedAt = 0

const fxStore = {
  async read(): Promise<FxRate | null> {
    const r = await db.query<{ value: string | null }>(`SELECT value FROM platform_infra WHERE key = 'fx_usd_inr'`)
    return r.rows[0]?.value ? JSON.parse(r.rows[0].value) : null
  },
  async write(r: FxRate): Promise<void> {
    await db.query(
      `INSERT INTO platform_infra (key, value) VALUES ('fx_usd_inr', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [JSON.stringify(r)]
    )
  },
}

export async function ensurePricing(): Promise<void> {
  if (!process.env.VITEST && Date.now() - fxCheckedAt >= 10 * 60_000) {
    fxCheckedAt = Date.now()
    await refreshUsdInr(fxStore)
  }
  if (Date.now() - loadedAt < 60_000) return
  try {
    const r = await db.query<{ value: string | null }>(`SELECT value FROM platform_infra WHERE key = 'message_pricing'`)
    setMessagePricing(r.rows[0]?.value ? JSON.parse(r.rows[0].value) : null)
    loadedAt = Date.now()
  } catch {
    // table not reachable from this pod: keep the defaults / last sheet
  }
}
