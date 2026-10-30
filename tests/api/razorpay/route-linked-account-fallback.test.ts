import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * A re-provisioned tenant's Razorpay linked account survives only on the owner-scoped
 * tenant_bank_accounts row (it cascades off owners, not tenants), so the tenant row can be
 * 'active' with a NULL razorpay_linked_account_id while the acc_xxx lives on the bank row.
 * The billing read resolves it via COALESCE(bank, tenant); the transfer path must too, or the
 * capture records the gross with no split and never moves the seller's money. This is the exact
 * bug that left an ₹11.80 order unsplit.
 *
 * The linked-account resolution now lives in ONE place — resolvePayoutTarget in route-settlement —
 * which every capture path (verify, webhook, subscription cycle) goes through via
 * recordCapturedPayment. This test guards that single resolver.
 */
const RESOLVER = 'packages/store-core/src/lib/payments/route-settlement.ts'

function resolvePayoutTargetQuery(): string {
  const src = fs.readFileSync(path.join(process.cwd(), RESOLVER), 'utf8')
  const start = src.indexOf('export async function resolvePayoutTarget')
  expect(start, `${RESOLVER} defines resolvePayoutTarget`).toBeGreaterThanOrEqual(0)
  const scope = src.slice(start, src.indexOf('\n}\n', start))
  const m = scope.match(/SELECT[\s\S]*?daily_payout[\s\S]*?FROM tenants/)
  expect(m, `${RESOLVER} resolvePayoutTarget selects the linked account`).not.toBeNull()
  return m![0]
}

describe('Route transfer resolves the linked account with the owner-bank fallback', () => {
  it('resolvePayoutTarget coalesces the owner bank row before the tenant column', () => {
    const q = resolvePayoutTargetQuery()
    expect(q).toContain('COALESCE')
    expect(q).toContain('tenant_bank_accounts')
    expect(q).toContain('owner_tenants')
    expect(q).toContain('t.razorpay_linked_account_id')
  })

  it('resolvePayoutTarget no longer reads the bare tenant column alone', () => {
    const q = resolvePayoutTargetQuery()
    expect(q).not.toMatch(/SELECT\s+razorpay_linked_account_id,\s*daily_payout\s+FROM\s+tenants\s+WHERE\s+id\s*=\s*\$1/)
  })

  it('gates the linked account on an active store (a suspended account must stay inert)', () => {
    const src = fs.readFileSync(path.join(process.cwd(), RESOLVER), 'utf8')
    expect(src).toMatch(/status === 'active'/)
  })

  it('every capture path goes through recordCapturedPayment, not a hand-rolled transfer', () => {
    for (const f of ['packages/store-core/src/lib/payments/capture.ts', 'packages/store-core/src/lib/subscriptions/cycle.ts']) {
      const src = fs.readFileSync(path.join(process.cwd(), f), 'utf8')
      expect(src, `${f} uses recordCapturedPayment`).toContain('recordCapturedPayment')
      expect(src, `${f} no longer calls transferToLinkedAccount directly`).not.toContain('transferToLinkedAccount')
    }
    for (const f of [
      'storefront-service/src/app/api/(public)/razorpay/verify/route.ts',
      'packages/store-core/src/lib/payments/razorpay-events/payments.ts',
    ]) {
      const src = fs.readFileSync(path.join(process.cwd(), f), 'utf8')
      expect(src, `${f} goes through lib/payments/capture`).toContain('@/lib/payments/capture')
      expect(src, `${f} no longer calls transferToLinkedAccount directly`).not.toContain('transferToLinkedAccount')
    }
  })
})
