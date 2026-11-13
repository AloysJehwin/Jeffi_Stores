// Admin-only product columns. Strip them from any `p.*` row before it reaches a shopper (page props, JSON).
export const INTERNAL_PRODUCT_KEYS = ['internal_notes', 'source_url', 'cost_price', 'supplier_id', 'search_vector'] as const

export function publicProduct<T>(row: T): T {
  if (!row || typeof row !== 'object') return row
  const out = { ...(row as Record<string, unknown>) }
  for (const k of INTERNAL_PRODUCT_KEYS) delete out[k]
  return out as T
}

export const publicProducts = <T>(rows: T[]): T[] => rows.map(publicProduct)
