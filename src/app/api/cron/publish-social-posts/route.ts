import { NextRequest, NextResponse } from 'next/server'
import { dueSocialPosts } from '@/lib/tenant-registry'
import { publishScheduledPost } from '@/lib/social/publisher'

export const dynamic = 'force-dynamic'

// Publishes due social posts. Driven by the in-app scheduler (instrumentation.ts) every ~1 min.
// Auth: Bearer ${CRON_SECRET} (same pattern as the other /api/cron routes).
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const due = await dueSocialPosts(20)
  const results: Array<{ id: string; ok: boolean; error?: string }> = []
  for (const post of due) {
    const r = await publishScheduledPost(post)
    results.push({ id: post.id, ok: r.ok, error: r.error })
  }
  return NextResponse.json({ success: true, published: results.filter((r) => r.ok).length, total: due.length, results })
}
