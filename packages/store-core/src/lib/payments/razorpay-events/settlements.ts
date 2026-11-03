import 'server-only'
import { applySettlementProcessed, applyTransferState, recordLinkedSettlement } from '@/lib/payments/route-settlement'
import { controlPlanePool } from '@/lib/tenant-registry'
import { flagshipScope, runInTenant, type WebhookTenant } from '@/lib/payments/webhook-tenant'
import type { EventContext } from './context'

/**
 * A Route transfer to a store's linked account changed state (processed, failed or reversed).
 * applyTransferState advances the store's ledger row from the transfer entity; own-account, gross-only
 * and COD rows are ignored inside it. Non-fatal bookkeeping.
 */
export async function onTransfer(transfer: any, ctx: EventContext) {
  if (ctx.source !== 'platform') return
  await applyTransferState(transfer).catch(() => {})
  if (transfer?.recipient_settlement_id) await recordLinkedSettlement({ settlementId: String(transfer.recipient_settlement_id) })
}

/**
 * A settlement was paid to a bank. From a Route store's linked account it is that store's payout: the
 * transfers it paid out are settled. Otherwise it is the account's own settlement (the platform's, or
 * an own-key store's), synced for that day.
 */
export async function onSettlementProcessed(settlement: any, ctx: EventContext) {
  if (!settlement?.id) return
  if (ctx.source === 'own') {
    if (ctx.store) syncSettlementDay(ctx.store, settlement)
    return
  }
  await applySettlementProcessed(settlement).catch(() => {})
  if (await isLinkedAccount(ctx.accountId)) await recordLinkedSettlement({ settlement, linkedAccountId: ctx.accountId })
  else syncSettlementDay(flagshipScope(), settlement)
}

async function isLinkedAccount(accountId: string | null | undefined): Promise<boolean> {
  if (!accountId) return false
  const r = await controlPlanePool()
    .query(
      `SELECT 1 FROM tenants WHERE razorpay_linked_account_id = $1
       UNION ALL SELECT 1 FROM tenant_bank_accounts WHERE linked_account_id = $1 LIMIT 1`,
      [accountId]
    )
    .catch(() => null)
  return !!r?.rowCount
}

// Not awaited: Razorpay wants a quick answer, and a missed day is picked up by the next scheduled sync.
function syncSettlementDay(store: WebhookTenant, settlement: any) {
  const day = new Date((Number(settlement.created_at) || Date.now() / 1000) * 1000)
  void runInTenant(store, async () => {
    const { syncRazorpaySettlements } = await import('@/lib/payments/rzp-settlements')
    await syncRazorpaySettlements({ day })
  }).catch(e => console.warn('[webhook:razorpay] settlement day sync skipped', settlement.id, e?.message ?? e))
}
