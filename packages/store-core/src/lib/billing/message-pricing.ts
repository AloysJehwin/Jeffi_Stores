import { controlPlanePool } from '@/lib/tenant-registry'
import { messagePricing, normalizeMessagePricing, setMessagePricing, type MessagePricing } from '@jeffi/pricing'
import { loadUsdInr } from './fx'

// The message pricing sheet (Ecom → Configuration → Message pricing): control-plane platform_infra 'message_pricing'.
// Loaded into @jeffi/pricing (cached a minute), with the live USD→INR rate, so its sync price functions use them;
// messaging-service has its own loader.

const KEY = 'message_pricing'
const TTL_MS = 60_000
let loadedAt = 0

export async function loadMessagePricing(force = false): Promise<MessagePricing> {
  await loadUsdInr()
  if (!force && Date.now() - loadedAt < TTL_MS) return messagePricing()
  try {
    const r = await controlPlanePool().query<{ value: string | null }>(`SELECT value FROM platform_infra WHERE key = $1`, [KEY])
    setMessagePricing(r.rows[0]?.value ? JSON.parse(r.rows[0].value) : null)
    loadedAt = Date.now()
  } catch {
    // control plane unreachable: keep the last sheet (or the defaults); retried on the next call
  }
  return messagePricing()
}

export async function saveMessagePricing(p: Partial<MessagePricing>): Promise<MessagePricing> {
  const clean = normalizeMessagePricing(p)
  await controlPlanePool().query(
    `INSERT INTO platform_infra (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [KEY, JSON.stringify(clean)]
  )
  setMessagePricing(clean)
  loadedAt = Date.now()
  return clean
}
