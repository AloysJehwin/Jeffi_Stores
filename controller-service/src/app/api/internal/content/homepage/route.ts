import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { verifyCronRequest } from '@/lib/shared/cron-auth'
import { resolveTenant } from '@/lib/tenancy/tenant-context'
import { logAdminAudit } from '@/lib/shared/admin-audit'
import { applyHomepageMirror, planHomepageMirror } from '@/lib/content/homepage-mirror'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// The flagship homepage bundle onto this store (deploy/k8s/db/60-live-content.sh). Bearer ${CRON_SECRET}.
// Body { apply: true } writes; anything else only reads and returns the plan.
export async function POST(request: NextRequest) {
  if (!verifyCronRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (await resolveTenant()) return NextResponse.json({ error: 'The bundle is the flagship store’s' }, { status: 400 })
  const body = (await request.json().catch(() => ({}))) as { apply?: boolean }
  try {
    if (body.apply !== true) return NextResponse.json({ ok: true, applied: false, plan: await planHomepageMirror() })
    const plan = await applyHomepageMirror()
    revalidatePath('/', 'layout')
    await logAdminAudit({
      adminId: null,
      action: 'update',
      entityType: 'homepage',
      summary: `Homepage mirrored from the ${plan.bundle} bundle`,
      metadata: plan as unknown as Record<string, unknown>,
      request,
    })
    return NextResponse.json({ ok: true, applied: true, plan })
  } catch (err) {
    console.error('[internal/content/homepage]', err)
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
