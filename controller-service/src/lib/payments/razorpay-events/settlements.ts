import 'server-only'
import { applySettlementProcessed, applyTransferState } from '@/lib/payments/route-settlement'
import type { EventContext } from './context'

/**
 * A Route transfer to a store's linked account changed state (processed, failed or reversed).
 * applyTransferState advances the store's ledger row from the transfer entity; own-account, gross-only
 * and COD rows are ignored inside it. Non-fatal bookkeeping.
 */
export async function onTransfer(transfer: any, ctx: EventContext) {
  if (ctx.source !== 'platform') return
  await applyTransferState(transfer).catch(() => {})
}

/** A settlement cleared: advance every Route transfer it paid out to 'settled'. */
export async function onSettlementProcessed(settlement: any, ctx: EventContext) {
  if (ctx.source !== 'platform') return
  await applySettlementProcessed(settlement).catch(() => {})
}
