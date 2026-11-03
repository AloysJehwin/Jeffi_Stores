import 'server-only'
import { controlPlanePool } from '@/lib/tenant-registry'

// When each Razorpay webhook last reached us, so the account card can tell a missing webhook apart
// from a quiet day. Written at most every five minutes per account.

const PLATFORM_KEY = 'razorpay_last_webhook_at'

export function noteRazorpayWebhook(tenantId: string | null) {
  try {
    write(tenantId)
  } catch {}
}

function write(tenantId: string | null) {
  const pool = controlPlanePool()
  const done = tenantId
    ? pool.query(
        `UPDATE tenant_integration_credentials
            SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('last_webhook_at', NOW())
          WHERE tenant_id = $1 AND provider = 'razorpay'
            AND COALESCE((meta->>'last_webhook_at')::timestamptz, 'epoch') < NOW() - INTERVAL '5 minutes'`,
        [tenantId]
      )
    : pool.query(
        `INSERT INTO platform_infra (key, value, updated_at) VALUES ($1, NOW()::text, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
          WHERE platform_infra.updated_at < NOW() - INTERVAL '5 minutes'`,
        [PLATFORM_KEY]
      )
  void done.catch(() => {})
}

export async function lastRazorpayWebhook(tenantId: string | null): Promise<string | null> {
  const pool = controlPlanePool()
  const r = tenantId
    ? await pool
        .query(`SELECT meta->>'last_webhook_at' AS at FROM tenant_integration_credentials WHERE tenant_id = $1 AND provider = 'razorpay'`, [tenantId])
        .catch(() => null)
    : await pool.query(`SELECT updated_at AS at FROM platform_infra WHERE key = $1`, [PLATFORM_KEY]).catch(() => null)
  const at = r?.rows[0]?.at
  return at ? new Date(at).toISOString() : null
}
