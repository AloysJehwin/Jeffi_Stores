import { NextRequest, NextResponse } from 'next/server'
import { dueSocialPosts, lookupTenantContextById, updateSocialPost } from '@/lib/tenant-registry'
import { runWithTenantContext } from '@/lib/tenancy/tenant-context'
import { publishScheduledPost } from '@/lib/social/publisher'
import { verifyCronRequest } from '@/lib/shared/cron-auth'

export const dynamic = 'force-dynamic'

// Publishes due social posts. Driven by the in-app scheduler (instrumentation.ts) every ~1 min.
// Auth: Bearer ${CRON_SECRET} (same pattern as the other /api/cron routes).
export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const due = await dueSocialPosts(20)
  const results: Array<{ id: string; ok: boolean; error?: string }> = []
  for (const post of due) {
    // Due posts span every tenant: product DB, caption plan gate and AI cache must be the post's own.
    let r: { ok: boolean; error?: string }
    if (post.tenant_id) {
      const ctx = await lookupTenantContextById(post.tenant_id)
      if (!ctx) {
        await updateSocialPost(post.id, { status: 'failed', lastError: 'tenant not active' })
        results.push({ id: post.id, ok: false, error: 'tenant not active' })
        continue
      }
      r = await runWithTenantContext(ctx, () => publishScheduledPost(post))
    } else {
      r = await publishScheduledPost(post)
    }
    results.push({ id: post.id, ok: r.ok, error: r.error })
  }
  return NextResponse.json({ success: true, published: results.filter(r => r.ok).length, total: due.length, results })
}
