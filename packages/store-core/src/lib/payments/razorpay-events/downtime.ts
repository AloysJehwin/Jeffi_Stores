import 'server-only'
import { recordDowntime } from '@/lib/payments/rzp-downtime'
import type { EventContext } from './context'

/** payment.downtime.*: an outage at a bank, card network or UPI app. Non-fatal bookkeeping. */
export async function onDowntime(type: string, downtime: any, ctx: EventContext) {
  await recordDowntime(type, downtime, ctx.source === 'own' ? ctx.store?.slug || 'own' : 'platform').catch(e =>
    console.warn('[webhook:razorpay] downtime not recorded', downtime?.id, e?.message ?? e)
  )
}
