import { revalidatePath } from 'next/cache'
import type { NextRequest } from 'next/server'
import { internalRequest } from '@/lib/shared/internal-http'
import { invalidateHomepageLayoutCache } from '@/lib/catalog/homepage-layout'
import { invalidateSiteCache } from './store'

// After a Site Builder publish, rollback or switch: drop the caches and ask the storefront app (which caches the
// pages, not the admin app) to re-render them.
export async function afterSiteChange(request: Pick<NextRequest, 'headers'>): Promise<void> {
  invalidateSiteCache()
  try {
    for (const p of ['/', '/business', '/products']) revalidatePath(p)
  } catch {
    // outside a request (a background build): the storefront refresh below still runs
  }
  await invalidateHomepageLayoutCache().catch(() => {})
  const secret = process.env.CRON_SECRET
  if (!secret) return
  const base = process.env.STOREFRONT_URL || 'http://127.0.0.1:3000'
  await internalRequest(`${base}/api/revalidate`, {
    method: 'POST',
    host: request.headers.get('host') ?? undefined,
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths: ['/', '/products', '/business'] }),
    timeoutMs: 3000,
  }).catch(e => console.warn(`[site-builder] storefront refresh: ${e?.message}`))
}
