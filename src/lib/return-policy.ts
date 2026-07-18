import { queryMany } from './db'

export interface ReturnPolicy {
  return_allowed: boolean
  return_window_days: number
  replacement_allowed: boolean
  replacement_window_days: number
}

export interface OrderItemPolicy extends ReturnPolicy {
  product_id: string
  product_name: string
  source: 'brand' | 'category' | 'parent_category' | 'default' | 'restrictive'
}

const DEFAULT_POLICY: ReturnPolicy = {
  return_allowed: true,
  return_window_days: 7,
  replacement_allowed: true,
  replacement_window_days: 7,
}

export async function getOrderItemsPolicy(orderId: string): Promise<OrderItemPolicy[]> {
  const rows = await queryMany<{
    product_id: string
    product_name: string
    brand_return_allowed: boolean | null
    brand_return_window_days: number | null
    brand_replacement_allowed: boolean | null
    brand_replacement_window_days: number | null
    category_return_allowed: boolean | null
    category_return_window_days: number | null
    category_replacement_allowed: boolean | null
    category_replacement_window_days: number | null
    parent_return_allowed: boolean | null
    parent_return_window_days: number | null
    parent_replacement_allowed: boolean | null
    parent_replacement_window_days: number | null
  }>(
    `SELECT
       oi.product_id::text,
       p.name AS product_name,
       b.return_allowed AS brand_return_allowed,
       b.return_window_days AS brand_return_window_days,
       b.replacement_allowed AS brand_replacement_allowed,
       b.replacement_window_days AS brand_replacement_window_days,
       c.return_allowed AS category_return_allowed,
       c.return_window_days AS category_return_window_days,
       c.replacement_allowed AS category_replacement_allowed,
       c.replacement_window_days AS category_replacement_window_days,
       pc.return_allowed AS parent_return_allowed,
       pc.return_window_days AS parent_return_window_days,
       pc.replacement_allowed AS parent_replacement_allowed,
       pc.replacement_window_days AS parent_replacement_window_days
     FROM order_items oi
     LEFT JOIN products p ON p.id = oi.product_id
     LEFT JOIN brands b ON b.id = p.brand_id
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN categories pc ON pc.id = c.parent_category_id
     WHERE oi.order_id = $1::uuid`,
    [orderId]
  )

  return rows.map(r => {
    const returnFlags = [r.brand_return_allowed, r.category_return_allowed, r.parent_return_allowed].filter(v => v !== null) as boolean[]
    const replaceFlags = [r.brand_replacement_allowed, r.category_replacement_allowed, r.parent_replacement_allowed].filter(v => v !== null) as boolean[]
    const returnWindows = [r.brand_return_window_days, r.category_return_window_days, r.parent_return_window_days].filter(v => v !== null) as number[]
    const replaceWindows = [r.brand_replacement_window_days, r.category_replacement_window_days, r.parent_replacement_window_days].filter(v => v !== null) as number[]

    const return_allowed = returnFlags.length > 0 ? returnFlags.every(Boolean) : DEFAULT_POLICY.return_allowed
    const replacement_allowed = replaceFlags.length > 0 ? replaceFlags.every(Boolean) : DEFAULT_POLICY.replacement_allowed
    const return_window_days = returnWindows.length > 0 ? Math.min(...returnWindows) : DEFAULT_POLICY.return_window_days
    const replacement_window_days = replaceWindows.length > 0 ? Math.min(...replaceWindows) : DEFAULT_POLICY.replacement_window_days

    let source: OrderItemPolicy['source'] = 'default'
    if (returnFlags.length === 0 && replaceFlags.length === 0) source = 'default'
    else if (returnFlags.length + replaceFlags.length > 2) source = 'restrictive'
    else if (r.brand_return_allowed !== null || r.brand_replacement_allowed !== null) source = 'brand'
    else if (r.category_return_allowed !== null || r.category_replacement_allowed !== null) source = 'category'
    else source = 'parent_category'

    return {
      product_id: r.product_id,
      product_name: r.product_name,
      return_allowed,
      return_window_days,
      replacement_allowed,
      replacement_window_days,
      source,
    }
  })
}

export async function checkReturnEligibility(
  orderId: string,
  type: 'refund' | 'replacement',
  deliveredAt: Date,
  itemIds?: string[]
): Promise<{ ok: true; effectiveWindowDays: number } | { ok: false; reason: string }> {
  const allPolicies = await getOrderItemsPolicy(orderId)
  if (allPolicies.length === 0) {
    return { ok: false, reason: 'Order has no items' }
  }

  // Scope to submitted items when provided; validates only what the user selected
  const policies = itemIds && itemIds.length > 0
    ? allPolicies.filter(p => itemIds.includes(p.product_id))
    : allPolicies

  if (policies.length === 0) {
    return { ok: false, reason: 'None of the selected items were found on this order' }
  }

  const blocked = policies.find(p =>
    type === 'refund' ? !p.return_allowed : !p.replacement_allowed
  )
  if (blocked) {
    return {
      ok: false,
      reason: type === 'refund'
        ? `Returns are not allowed for "${blocked.product_name}".`
        : `Replacements are not allowed for "${blocked.product_name}".`,
    }
  }

  const effectiveWindow = Math.min(
    ...policies.map(p =>
      type === 'refund' ? p.return_window_days : p.replacement_window_days
    )
  )

  const cutoff = new Date(deliveredAt.getTime() + effectiveWindow * 24 * 60 * 60 * 1000)
  if (new Date() > cutoff) {
    return {
      ok: false,
      reason: `${type === 'refund' ? 'Return' : 'Replacement'} window has closed. The window for this order was ${effectiveWindow} day${effectiveWindow !== 1 ? 's' : ''} from delivery.`,
    }
  }

  return { ok: true, effectiveWindowDays: effectiveWindow }
}
