import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * A re-provisioned tenant's Razorpay linked account survives only on the owner-scoped
 * tenant_bank_accounts row (it cascades off owners, not tenants), so the tenant row can be
 * 'active' with a NULL razorpay_linked_account_id while the acc_xxx lives on the bank row.
 * The billing read already resolves it via COALESCE(bank, tenant); the two transfer paths must
 * too, or fireRouteTransfer takes the no-linked-account branch, records the gross with no split,
 * and never moves the seller's money. This is the exact bug that left an ₹11.80 order unsplit.
 */
const TRANSFER_ROUTES = ['src/app/api/razorpay/verify/route.ts', 'src/app/api/webhooks/razorpay/route.ts']

function fireRouteTransferQuery(file: string): string {
  const src = fs.readFileSync(path.join(process.cwd(), file), 'utf8')
  const start = src.indexOf('async function fireRouteTransfer')
  expect(start, `${file} defines fireRouteTransfer`).toBeGreaterThanOrEqual(0)
  const scope = src.slice(start, src.indexOf('\n}\n', start))
  const m = scope.match(/SELECT[\s\S]*?daily_payout[\s\S]*?status='active'/)
  expect(m, `${file} fireRouteTransfer selects the linked account gated on status='active'`).not.toBeNull()
  return m![0]
}

describe('Route transfer resolves the linked account with the owner-bank fallback', () => {
  for (const file of TRANSFER_ROUTES) {
    it(`${file} coalesces the owner bank row before the tenant column`, () => {
      const q = fireRouteTransferQuery(file)
      expect(q).toContain('COALESCE')
      expect(q).toContain('tenant_bank_accounts')
      expect(q).toContain('owner_tenants')
      expect(q).toContain('t.razorpay_linked_account_id')
    })

    it(`${file} no longer reads the bare tenant column alone`, () => {
      const q = fireRouteTransferQuery(file)
      expect(q).not.toMatch(/SELECT\s+razorpay_linked_account_id,\s*daily_payout\s+FROM\s+tenants\s+WHERE\s+id=\$1/)
    })
  }
})
