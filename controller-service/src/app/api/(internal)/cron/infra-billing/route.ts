import { NextRequest, NextResponse } from 'next/server'
import { verifyCronRequest } from '@/lib/shared/cron-auth'
import { chargeInfra } from '@controller/lib/billing/infra-billing'
import { applyInfraBalancePolicy } from '@controller/lib/billing/infra-balance'
import { getProvisioningProvider } from '@controller/lib/provisioning'

export const dynamic = 'force-dynamic'

// Daily: charge each store's wallet for yesterday's servers (and any day a missed run left), then warn,
// pause or keep paused the stores that can't pay. Auth: Bearer ${CRON_SECRET}.
export async function GET(req: NextRequest) {
  if (!verifyCronRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const charges = await chargeInfra()
  const actions = await applyInfraBalancePolicy(getProvisioningProvider())
  const failed = charges.filter(c => c.error)
  if (failed.length) console.error(`[infra-billing] ${failed.length} charge(s) failed`, failed)
  return NextResponse.json({
    success: !failed.length,
    charged: charges.filter(c => c.charged).length,
    totalInr: Math.round(charges.reduce((n, c) => n + (c.charged ? c.amountInr : 0), 0) * 100) / 100,
    failed,
    actions,
  })
}
