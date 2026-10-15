// Single source of truth for the two-level digital/subscription/download switches.
// Effective state is ALWAYS the Site Controls master flag AND the per-product (or per-file)
// flag — never one without the other. Keep this logic here so storefront, business, PDP and
// card surfaces can't drift.

/** A product's digital-facing flags, as read straight off the products row. */
export interface DigitalProductFlags {
  isDigital: boolean
  isSubscription: boolean
  downloadable: boolean
  fileFormat?: string | null
  platformCompatibility?: string[] | null
}

/** Resolved UI state for a product once master flags are applied. */
export interface DigitalUiState {
  /** Treat this as a digital product in the UI (hide shipping/EDD/COD/qty, show Digital badge). */
  isDigital: boolean
  /** Offer the subscribe path. */
  subscribe: boolean
  /** Vault downloads are offered (master && product.downloadable). */
  download: boolean
  /** File formats to surface, e.g. ['PDF', 'EPUB']. */
  formats: string[]
}

/** Effective download = store master switch AND the product/file's own `downloadable`. */
export function effectiveDownloadable(masterOn: boolean, productOrFileDownloadable: boolean): boolean {
  return masterOn && productOrFileDownloadable
}

/** Effective subscribe = subscriptions master switch AND the product being a subscription. */
export function subscribeAllowed(masterOn: boolean, productIsSubscription: boolean): boolean {
  return masterOn && productIsSubscription
}

/** True when the product should render with the digital treatment (master gate && product flag). */
export function digitalActive(digitalProductsEnabled: boolean, productIsDigital: boolean): boolean {
  return digitalProductsEnabled && productIsDigital
}

/** Normalize file_format + platform_compatibility into a de-duped, trimmed label list. */
export function fileFormats(fileFormat?: string | null, platformCompatibility?: string[] | null): string[] {
  const out: string[] = []
  if (fileFormat) out.push(...fileFormat.split(/[,/]/))
  if (platformCompatibility) out.push(...platformCompatibility)
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of out) {
    const v = raw.trim()
    if (!v) continue
    const key = v.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(v)
  }
  return result
}

/**
 * Resolve the full digital UI state for a product.
 * masters: the three Site Controls master flags; p: the product's own flags.
 */
export function resolveDigitalUi(
  masters: { digitalProductsEnabled: boolean; subscriptionsEnabled: boolean; vaultDownloadsEnabled: boolean },
  p: DigitalProductFlags
): DigitalUiState {
  const isDigital = digitalActive(masters.digitalProductsEnabled, p.isDigital)
  return {
    isDigital,
    // Physical and digital products both subscribe; a digital one only while digital is on.
    subscribe: subscribeAllowed(masters.subscriptionsEnabled, p.isSubscription) && (!p.isDigital || isDigital),
    download: isDigital && effectiveDownloadable(masters.vaultDownloadsEnabled, p.downloadable),
    formats: isDigital ? fileFormats(p.fileFormat, p.platformCompatibility) : [],
  }
}
