import { NextRequest, NextResponse } from 'next/server'
import { verifyCronRequest } from '@/lib/shared/cron-auth'
import { sweepStaleHolds, type HoldSweep } from '@/lib/ai/paid-generation'

export const dynamic = 'force-dynamic'

// Every 15 min (CRON_JOBS ai_hold_sweep): a paid AI generation's wallet hold still open 2 h after it was taken (its run
// died) is charged the cost the run recorded × margin, never above the cap, and the rest refunded. A hold it can't
// settle answers 500, so the run shows as failed on the cron status page, and is mailed to the platform admin once.
export async function POST(req: NextRequest) {
  if (!verifyCronRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const run = await sweepStaleHolds()
    if (run.settled.length) console.warn(`[ai-hold-sweep] settled ${run.settled.length} stuck hold(s)`, run.settled)
    const fresh = run.failed.filter(f => f.firstFailure)
    if (fresh.length) await alertUnsettled(fresh).catch(e => console.error('[ai-hold-sweep] alert failed:', (e as Error).message))
    return NextResponse.json(run, { status: run.failed.length ? 500 : 200 })
  } catch (e) {
    console.error('[ai-hold-sweep] sweep failed:', (e as Error).message)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

async function alertUnsettled(failed: HoldSweep['failed']): Promise<void> {
  const body =
    failed.map(f => `- ${f.walletRef} (tenant ${f.tenantId}): ₹${f.capInr} held. ${f.error}`).join('\n') +
    '\n\nThe owner stays charged the whole hold until it settles. The sweep retries every 15 minutes; each hold is reported once.'
  if (process.env.NODE_ENV !== 'production') {
    console.error(`[ai-hold-sweep] alert suppressed outside production:\n${body}`)
    return
  }
  const { sendPlatformAlert } = await import('@controller/lib/provisioning/alerts')
  await sendPlatformAlert('[Jeffi] AI wallet holds not settled', body, {
    kind: 'ai_hold_alert',
    kicker: 'Wallet Alert',
    footer: 'Automated AI wallet hold sweep (every 15 min).',
  })
}
