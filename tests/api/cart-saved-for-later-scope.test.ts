import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'

const src = (path: string) => readFileSync(path, 'utf8')

// Saved-for-later rows live in cart_items with saved_for_later = TRUE. Checkout must neither order
// them nor wipe them: COD read them as order lines, and the webhook fallback deleted them.
describe('checkout leaves saved-for-later items alone', () => {
  it('COD orders only the active cart lines', () => {
    const route = src('src/app/api/(public)/orders/create/route.ts')
    expect(route).toMatch(
      /FROM cart_items ci[\s\S]*?WHERE ci\.user_id = \$1 AND COALESCE\(ci\.saved_for_later, FALSE\) = FALSE/
    )
  })

  it('every cart clear on payment keeps saved items', () => {
    for (const path of [
      'src/app/api/(public)/orders/create/route.ts',
      'src/app/api/(public)/razorpay/verify/route.ts',
      'src/app/api/(public)/webhooks/razorpay/route.ts',
    ]) {
      const deletes = src(path).match(/DELETE FROM cart_items WHERE user_id = \$1[^'`]*/g) ?? []
      expect(deletes.length).toBeGreaterThan(0)
      for (const d of deletes) expect(`${path}: ${d}`).toContain('saved_for_later')
    }
  })
})
