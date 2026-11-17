import { controlPlanePool } from '@/lib/tenant-registry'
import { refreshUsdInr, usdInrRate, type FxRate } from '@jeffi/pricing'

// The live USD→INR rate for this process (see @jeffi/pricing), shared through control-plane platform_infra
// 'fx_usd_inr'. Checked against that row every ten minutes; fetched again when it is older than six hours.

const KEY = 'fx_usd_inr'
const CHECK_MS = 10 * 60_000
let checkedAt = 0

const store = {
  async read(): Promise<FxRate | null> {
    const r = await controlPlanePool().query<{ value: string | null }>(`SELECT value FROM platform_infra WHERE key = $1`, [KEY])
    return r.rows[0]?.value ? JSON.parse(r.rows[0].value) : null
  },
  async write(r: FxRate): Promise<void> {
    await controlPlanePool().query(
      `INSERT INTO platform_infra (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [KEY, JSON.stringify(r)]
    )
  },
}

/** The live rate, kept current for usdToInr and every USD price. wait: block on a fresh fetch when the stored one is stale. */
export async function loadUsdInr(opts: { wait?: boolean } = {}): Promise<FxRate> {
  if (process.env.VITEST || (!opts.wait && Date.now() - checkedAt < CHECK_MS)) return usdInrRate()
  checkedAt = Date.now()
  return refreshUsdInr(store, opts)
}
