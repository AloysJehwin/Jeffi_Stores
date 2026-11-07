// Order sources that are marketplace sales (client-safe: no imports).
export const MARKETPLACE_SOURCES = ['amazon', 'myntra', 'ajio'] as const
export type MarketplaceSource = (typeof MARKETPLACE_SOURCES)[number]

export const MARKETPLACE_LABELS: Record<MarketplaceSource, string> = { amazon: 'Amazon', myntra: 'Myntra', ajio: 'AJIO' }

export function isMarketplaceSource(s: string | null | undefined): s is MarketplaceSource {
  return !!s && (MARKETPLACE_SOURCES as readonly string[]).includes(s)
}

/** SQL list literal for `source IN ${MARKETPLACE_SOURCES_SQL}`. */
export const MARKETPLACE_SOURCES_SQL = `(${MARKETPLACE_SOURCES.map(s => `'${s}'`).join(', ')})`
