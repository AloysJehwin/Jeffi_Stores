// Product copy for single-product campaign messages: {productSummary} and {productHighlights}.

/** Columns to add to a scenario's product SELECT (alias p). */
export const PRODUCT_CONTENT_SQL = `COALESCE(NULLIF(btrim(p.short_description), ''), p.ai_description) AS product_summary, p.ai_features AS product_features`

export function productContentVars(r: object) {
  const row = r as { product_summary?: unknown; product_features?: unknown }
  const features = Array.isArray(row.product_features) ? row.product_features.map(f => String(f).trim()).filter(Boolean) : []
  return {
    productSummary: typeof row.product_summary === 'string' ? row.product_summary.trim().slice(0, 300) : '',
    productHighlights: features.slice(0, 3).map(f => f.charAt(0).toUpperCase() + f.slice(1)).join(' · '),
  }
}
