import { queryMany } from './db'
import { getCurrentTenant } from './tenant-context'

// Centralized reader for all admin-controlled store settings, backed by the
// site_settings key/value table. Mirrors the cache pattern in delivery-settings.ts:
// one batched query, 30s in-memory cache, typed defaults, never throws.
//
// GUIDING PRINCIPLE: every DEFAULT here equals the value that was previously
// hardcoded or read from an env var. With an empty site_settings table the store
// behaves byte-identically to before this feature existed.

export interface StoreIdentity {
  name: string
  email: string
  phone: string
  web: string
  logoUrl: string   // '' means "no logo" — render the store name as text
}

export interface FeatureFlags {
  razorpayEnabled: boolean
  // Site-level Cash-on-Delivery gate. COD is offered only when this is on AND every cart
  // product's own is_cod_allowed is true (two-place validation).
  codEnabled: boolean
  gstEnabled: boolean
  // When false, confirmed→processing order status change skips inventory validation.
  // Basic plan tenants have no inventory module so this defaults to false for them.
  // Can be toggled per-tenant from the site settings page.
  inventoryValidationEnabled: boolean
  // SMS and WhatsApp notification channels — Growth+ only.
  // When off, these channels are hidden from the storefront signin/signup page.
  smsEnabled: boolean
  whatsappEnabled: boolean
  // Master on/off for each on-device AI feature.
  ondeviceSummaryEnabled: boolean
  ondeviceFinetuneEnabled: boolean
  // Per-platform gates: where on-device is allowed to run. Effective = master && platform.
  // Mobile defaults to false (phones fall back to the server Ollama path instead of
  // downloading the ~417MB model). Desktop mirrors the master default.
  ondeviceSummaryMobileEnabled: boolean
  ondeviceSummaryDesktopEnabled: boolean
  ondeviceFinetuneMobileEnabled: boolean
  ondeviceFinetuneDesktopEnabled: boolean
}

export interface BusinessValues {
  codSurchargeFlat: number
  codSurchargePct: number
  shippingMinCharge: number
  shippingMaxCharge: number
  orderAutoCancelMinutes: number
  returnStandardCharge: number
  delhiveryOriginPincode: string
  businessStateCode: string
  defaultProductWeightG: number
  // Fallback shipping weight used when a product's own weight is missing OR very low (<= 50g),
  // so under-weighed items still price against a realistic parcel weight.
  defaultWeightG: number
  pickupLocation: string
  sellerName: string
  sellerAddress: string
  sellerPhone: string
}

export interface StorefrontContent {
  featuredLimit: number
  newArrivalsLimit: number
  statsJson: string      // JSON string of [{label,value}] or ''
  aboutCopy: string
  /** Appended after the store name in the browser tab, e.g. "Industrial Hardware & Tools". */
  metaTagline: string
  /** <meta name="description">. Empty falls back to a generic line built from the store name. */
  metaDescription: string
}

export interface KeyboardShortcuts {
  newProduct: string
  cashSale: string
  quotation: string
  newPo: string
  orders: string
  packingSlips: string
  returns: string
  gst: string
  labels: string
  inventory: string
  coupons: string
  campaign: string
  financial: string
  customers: string
  crm: string
  reviews: string
  aiAgent: string
  customShortcuts: string  // JSON: [{id,label,path,combo}]
}

export interface SiteControls {
  identity: StoreIdentity
  flags: FeatureFlags
  values: BusinessValues
  storefront: StorefrontContent
  shortcuts: KeyboardShortcuts
  // Whether the current tenant ships on its own Delhivery account. Platform store / no tenant in
  // scope is treated as true. Drives the COD gate and the admin COD-toggle lock.
  ownDelhivery: boolean
}

// Defaults equal the pre-existing hardcoded / env-var values.
const envBool = (v: string | undefined) => v === 'true'
const envNum = (v: string | undefined, def: number) => {
  const n = parseFloat(v ?? '')
  return Number.isFinite(n) ? n : def
}

const DEFAULTS: SiteControls = {
  identity: {
    name: 'Jeffi Stores',
    email: 'jeffistoress@gmail.com',
    phone: '+91 96853 54099',
    web: 'jeffistores.in',
    logoUrl: '',
  },
  flags: {
    // Preserve current env-driven behavior when the DB key is unset.
    razorpayEnabled: envBool(process.env.ENABLE_RAZORPAY),
    codEnabled: true,
    gstEnabled: envBool(process.env.ENABLE_GST),
    inventoryValidationEnabled: true,
    smsEnabled: process.env.SMS_DISABLED !== 'true',
    whatsappEnabled: process.env.WHATSAPP_DISABLED !== 'true',
    ondeviceSummaryEnabled: envBool(process.env.NEXT_PUBLIC_ENABLE_ONDEVICE_SUMMARY) || process.env.NEXT_PUBLIC_ENABLE_ONDEVICE_SUMMARY === '1',
    ondeviceFinetuneEnabled: envBool(process.env.NEXT_PUBLIC_ENABLE_ONDEVICE_FINETUNE) || process.env.NEXT_PUBLIC_ENABLE_ONDEVICE_FINETUNE === '1',
    // Desktop mirrors the master default; mobile is off by default (server fallback).
    ondeviceSummaryDesktopEnabled: envBool(process.env.NEXT_PUBLIC_ENABLE_ONDEVICE_SUMMARY_DESKTOP) || process.env.NEXT_PUBLIC_ENABLE_ONDEVICE_SUMMARY_DESKTOP === '1' || envBool(process.env.NEXT_PUBLIC_ENABLE_ONDEVICE_SUMMARY) || process.env.NEXT_PUBLIC_ENABLE_ONDEVICE_SUMMARY === '1',
    ondeviceSummaryMobileEnabled: envBool(process.env.NEXT_PUBLIC_ENABLE_ONDEVICE_SUMMARY_MOBILE) || process.env.NEXT_PUBLIC_ENABLE_ONDEVICE_SUMMARY_MOBILE === '1',
    ondeviceFinetuneDesktopEnabled: envBool(process.env.NEXT_PUBLIC_ENABLE_ONDEVICE_FINETUNE_DESKTOP) || process.env.NEXT_PUBLIC_ENABLE_ONDEVICE_FINETUNE_DESKTOP === '1' || envBool(process.env.NEXT_PUBLIC_ENABLE_ONDEVICE_FINETUNE) || process.env.NEXT_PUBLIC_ENABLE_ONDEVICE_FINETUNE === '1',
    ondeviceFinetuneMobileEnabled: envBool(process.env.NEXT_PUBLIC_ENABLE_ONDEVICE_FINETUNE_MOBILE) || process.env.NEXT_PUBLIC_ENABLE_ONDEVICE_FINETUNE_MOBILE === '1',
  },
  values: {
    codSurchargeFlat: envNum(process.env.COD_SURCHARGE_FLAT, 40),
    codSurchargePct: envNum(process.env.COD_SURCHARGE_PCT, 2),
    shippingMinCharge: envNum(process.env.SHIPPING_MIN_CHARGE, 0),
    shippingMaxCharge: envNum(process.env.SHIPPING_MAX_CHARGE, 200),
    orderAutoCancelMinutes: 10,
    returnStandardCharge: envNum(process.env.RETURN_STANDARD_CHARGE, 100),
    delhiveryOriginPincode: process.env.DELHIVERY_ORIGIN_PINCODE || '492001',
    businessStateCode: process.env.BUSINESS_STATE_CODE || '22',
    defaultProductWeightG: 500,
    defaultWeightG: 50,
    pickupLocation: process.env.DELHIVERY_PICKUP_LOCATION || 'Jeffi Stores',
    sellerName: process.env.DELHIVERY_SELLER_NAME || 'Jeffi Stores',
    sellerAddress: process.env.DELHIVERY_SELLER_ADDRESS || 'Near Arihant Complex, Sanjay Gandhi Chowk, Station Road, Raipur',
    sellerPhone: process.env.DELHIVERY_SELLER_PHONE || '07713585374',
  },
  storefront: {
    featuredLimit: 8,
    newArrivalsLimit: 4,
    statsJson: '',
    // The flagship's own description. Scoped like the tagline below: a tenant selling
    // something else must not inherit a hardware shop's copy on its homepage.
    aboutCopy: 'Jeffi Stores is built for industry — offering machinery parts, fasteners, tools, and electrical components for manufacturing, construction, and industrial repairs.',
    // The flagship's trade. A tenant inherits neither — its own values come from its DB, and
    // an unset tagline simply drops from the title rather than advertising someone else's trade.
    metaTagline: 'Industrial Hardware & Tools',
    metaDescription: 'Your trusted hardware partner for industrial machinery parts, tools, and equipment',
  },
  shortcuts: {
    newProduct: 'mod+shift+p',
    cashSale: 'mod+shift+s',
    quotation: 'mod+shift+q',
    newPo: 'mod+shift+o',
    orders: 'mod+shift+r',
    packingSlips: 'mod+shift+k',
    returns: 'mod+shift+u',
    gst: 'mod+shift+g',
    labels: 'mod+shift+l',
    inventory: 'mod+shift+i',
    coupons: 'mod+shift+c',
    campaign: 'mod+shift+m',
    financial: 'mod+shift+f',
    customers: 'mod+shift+e',
    crm: 'mod+shift+x',
    reviews: 'mod+shift+v',
    aiAgent: 'mod+shift+a',
    customShortcuts: '[]',
  },
  ownDelhivery: true,
}

const KEYS = [
  'business_name', 'business_email', 'business_phone', 'business_web', 'business_logo_url',
  'feature_razorpay_enabled', 'feature_cod_enabled', 'feature_gst_enabled', 'feature_inventory_validation_enabled',
  'feature_sms_enabled', 'feature_whatsapp_enabled',
  'feature_ondevice_summary_enabled', 'feature_ondevice_finetune_enabled',
  'feature_ondevice_summary_mobile_enabled', 'feature_ondevice_summary_desktop_enabled',
  'feature_ondevice_finetune_mobile_enabled', 'feature_ondevice_finetune_desktop_enabled',
  'cod_surcharge_flat', 'cod_surcharge_pct', 'shipping_min_charge', 'shipping_max_charge',
  'order_auto_cancel_minutes', 'delhivery_origin_pincode', 'business_state_code',
  'return_standard_charge',
  'default_product_weight_g', 'default_weight_g',
  'delhivery_pickup_location', 'delhivery_seller_name', 'delhivery_seller_address', 'delhivery_seller_phone',
  'storefront_featured_limit', 'storefront_new_arrivals_limit',
  'storefront_stats_json', 'storefront_about_copy',
  'shortcut_new_product', 'shortcut_cash_sale', 'shortcut_quotation', 'shortcut_new_po',
  'shortcut_orders', 'shortcut_packing_slips', 'shortcut_returns', 'shortcut_gst',
  'shortcut_labels', 'shortcut_inventory', 'shortcut_coupons', 'shortcut_campaign',
  'shortcut_financial', 'shortcut_customers', 'shortcut_crm', 'shortcut_reviews',
  'shortcut_ai_agent', 'shortcut_custom',
  'meta_tagline', 'meta_description',
]

/**
 * Cached PER TENANT, not globally.
 *
 * site_settings is read through queryMany, which routes to the tenant's own database — so the
 * VALUES were always tenant-correct. The cache was not: a single module-level entry meant
 * whichever request populated it first served its identity to everyone else for the TTL. A
 * tenant storefront could render the platform's name, logo, email and phone (or another
 * tenant's), which is both a wrong-brand bug and cross-tenant leakage in the most visible place
 * on the page.
 */
const cache = new Map<string, { value: SiteControls; expiresAt: number }>()
const TTL_MS = 30 * 1000

/**
 * Cache key: the tenant whose database this read will actually hit.
 *
 * Must not rely on the AsyncLocalStorage context alone. That context is established lazily, by
 * the first database query of the request — and getSiteControls() computes its key BEFORE it
 * queries, so on a tenant host the key was still 'platform'. Every tenant then shared the
 * platform's cache entry: a pool box answering one request without a tenant slug cached
 * "Jeffi Stores" under that key, and every tenant storefront rendered it until the TTL expired.
 *
 * The x-tenant-slug header is set by middleware and is available before any query, so it gives
 * the right key on the first call. Falls back to the ALS context for non-request work (jobs),
 * where headers() throws.
 */
async function cacheKey(): Promise<string> {
  const t = getCurrentTenant()
  if (t) return t.tenantId
  const slug = await tenantSlugFromHeaders()
  return slug ? `slug:${slug}` : 'platform'
}

/** The request's tenant slug, or null outside a request scope / on the platform host. */
async function tenantSlugFromHeaders(): Promise<string | null> {
  try {
    const { headers } = await import('next/headers')
    return (await headers()).get('x-tenant-slug')
  } catch {
    return null
  }
}

/**
 * Identity fallbacks for a store with nothing configured yet.
 *
 * DEFAULTS carries the PLATFORM's name, email and phone. A freshly provisioned tenant has no
 * site_settings rows, so every unset field fell back to those and the tenant's storefront
 * rendered "Jeffi Stores" with the platform's contact details — the single biggest reason the
 * platform name still showed up on tenant stores.
 *
 * On a tenant we can honestly supply a name and web address from the tenant record. We cannot
 * invent a support email or phone, and showing the platform's would be worse than showing
 * none, so those stay empty until the owner sets them.
 */
async function identityDefaults(): Promise<StoreIdentity> {
  const t = getCurrentTenant()
  const slug = t?.slug ?? (await tenantSlugFromHeaders())
  if (!slug) return DEFAULTS.identity
  const domain = process.env.PLATFORM_DOMAIN || 'jeffistores.in'
  // The ALS context is established lazily by the first DB query, so on a page that has not
  // queried yet (the login screen) it is empty and only the header slug is known. Resolving
  // the tenant by slug recovers its real name — otherwise the store is shown its own URL
  // slug, "aloys-jehwin Store", instead of the business name it registered.
  let displayName = t?.displayName?.trim()
  if (!displayName) {
    const { lookupTenantContextBySlug } = await import('./tenant-registry')
    displayName = (await lookupTenantContextBySlug(slug).catch(() => null))?.displayName?.trim() || ''
  }
  return {
    name: displayName || `${slug} Store`,
    email: '',
    phone: '',
    web: `${slug}.${domain}`,
    logoUrl: '',
  }
}

export async function getSiteControls(): Promise<SiteControls> {
  const key = await cacheKey()
  const hit = cache.get(key)
  if (hit && Date.now() < hit.expiresAt) return hit.value

  try {
    const rows = await queryMany<{ key: string; value: string }>(
      `SELECT key, value FROM site_settings WHERE key = ANY($1::text[])`,
      [KEYS]
    )
    const m = new Map(rows.map(r => [r.key, r.value]))

    const str = (k: string, def: string) => {
      const v = m.get(k)
      return v != null && v !== '' ? v : def
    }
    const num = (k: string, def: number) => {
      const v = m.get(k)
      if (v == null || v === '') return def
      const n = parseFloat(v)
      return Number.isFinite(n) ? n : def
    }
    const bool = (k: string, def: boolean) => {
      const v = m.get(k)
      if (v == null || v === '') return def
      return v.toLowerCase() === 'true'
    }

    const d = DEFAULTS
    // Identity falls back to the tenant's own record on a tenant host, never the platform's.
    const id = await identityDefaults()
    // Header-aware like identityDefaults: the ALS may be empty on a page that hasn't queried yet,
    // but the x-tenant-slug header still marks a tenant host — otherwise the flagship's tagline,
    // about copy and meta description leak onto a tenant store that hasn't set its own.
    const tenantScoped = getCurrentTenant() != null || (await tenantSlugFromHeaders()) != null
    const result: SiteControls = {
      identity: {
        name: str('business_name', id.name),
        email: str('business_email', id.email),
        phone: str('business_phone', id.phone),
        web: str('business_web', id.web),
        logoUrl: str('business_logo_url', id.logoUrl),
      },
      flags: {
        razorpayEnabled: bool('feature_razorpay_enabled', d.flags.razorpayEnabled),
        codEnabled: bool('feature_cod_enabled', d.flags.codEnabled),
        gstEnabled: bool('feature_gst_enabled', d.flags.gstEnabled),
        inventoryValidationEnabled: bool('feature_inventory_validation_enabled', d.flags.inventoryValidationEnabled),
        smsEnabled: bool('feature_sms_enabled', d.flags.smsEnabled),
        whatsappEnabled: bool('feature_whatsapp_enabled', d.flags.whatsappEnabled),
        ondeviceSummaryEnabled: bool('feature_ondevice_summary_enabled', d.flags.ondeviceSummaryEnabled),
        ondeviceFinetuneEnabled: bool('feature_ondevice_finetune_enabled', d.flags.ondeviceFinetuneEnabled),
        ondeviceSummaryMobileEnabled: bool('feature_ondevice_summary_mobile_enabled', d.flags.ondeviceSummaryMobileEnabled),
        ondeviceSummaryDesktopEnabled: bool('feature_ondevice_summary_desktop_enabled', d.flags.ondeviceSummaryDesktopEnabled),
        ondeviceFinetuneMobileEnabled: bool('feature_ondevice_finetune_mobile_enabled', d.flags.ondeviceFinetuneMobileEnabled),
        ondeviceFinetuneDesktopEnabled: bool('feature_ondevice_finetune_desktop_enabled', d.flags.ondeviceFinetuneDesktopEnabled),
      },
      values: {
        codSurchargeFlat: Math.max(0, num('cod_surcharge_flat', d.values.codSurchargeFlat)),
        codSurchargePct: Math.max(0, num('cod_surcharge_pct', d.values.codSurchargePct)),
        shippingMinCharge: Math.max(0, num('shipping_min_charge', d.values.shippingMinCharge)),
        shippingMaxCharge: Math.max(0, num('shipping_max_charge', d.values.shippingMaxCharge)),
        orderAutoCancelMinutes: Math.max(1, num('order_auto_cancel_minutes', d.values.orderAutoCancelMinutes)),
        returnStandardCharge: Math.max(0, num('return_standard_charge', d.values.returnStandardCharge)),
        delhiveryOriginPincode: str('delhivery_origin_pincode', d.values.delhiveryOriginPincode),
        businessStateCode: str('business_state_code', d.values.businessStateCode),
        defaultProductWeightG: Math.max(1, num('default_product_weight_g', d.values.defaultProductWeightG)),
        defaultWeightG: Math.max(1, num('default_weight_g', d.values.defaultWeightG)),
        pickupLocation: str('delhivery_pickup_location', d.values.pickupLocation),
        sellerName: str('delhivery_seller_name', d.values.sellerName),
        sellerAddress: str('delhivery_seller_address', d.values.sellerAddress),
        sellerPhone: str('delhivery_seller_phone', d.values.sellerPhone),
      },
      storefront: {
        featuredLimit: Math.max(1, Math.round(num('storefront_featured_limit', d.storefront.featuredLimit))),
        newArrivalsLimit: Math.max(1, Math.round(num('storefront_new_arrivals_limit', d.storefront.newArrivalsLimit))),
        statsJson: str('storefront_stats_json', d.storefront.statsJson),
        aboutCopy: str('storefront_about_copy', tenantScoped ? '' : d.storefront.aboutCopy),
        metaTagline: str('meta_tagline', tenantScoped ? '' : d.storefront.metaTagline),
        metaDescription: str('meta_description', tenantScoped ? '' : d.storefront.metaDescription),
      },
      shortcuts: {
        newProduct:   str('shortcut_new_product',   d.shortcuts.newProduct),
        cashSale:     str('shortcut_cash_sale',     d.shortcuts.cashSale),
        quotation:    str('shortcut_quotation',     d.shortcuts.quotation),
        newPo:        str('shortcut_new_po',        d.shortcuts.newPo),
        orders:       str('shortcut_orders',        d.shortcuts.orders),
        packingSlips: str('shortcut_packing_slips', d.shortcuts.packingSlips),
        returns:      str('shortcut_returns',       d.shortcuts.returns),
        gst:          str('shortcut_gst',           d.shortcuts.gst),
        labels:       str('shortcut_labels',        d.shortcuts.labels),
        inventory:    str('shortcut_inventory',     d.shortcuts.inventory),
        coupons:      str('shortcut_coupons',       d.shortcuts.coupons),
        campaign:     str('shortcut_campaign',      d.shortcuts.campaign),
        financial:    str('shortcut_financial',     d.shortcuts.financial),
        customers:    str('shortcut_customers',     d.shortcuts.customers),
        crm:          str('shortcut_crm',           d.shortcuts.crm),
        reviews:      str('shortcut_reviews',       d.shortcuts.reviews),
        aiAgent:      str('shortcut_ai_agent',      d.shortcuts.aiAgent),
        customShortcuts: str('shortcut_custom',     d.shortcuts.customShortcuts),
      },
      ownDelhivery: d.ownDelhivery,
    }

    // COD is offered only to tenants shipping on their own Delhivery account (own_delhivery). A
    // platform-Delhivery tenant's shipping cost is fronted by the platform and reconciled post-pickup
    // against the prepaid wallet, so COD (no upfront collection) would leave that charge unrecoverable.
    // Gate it here at the single source that flows to the buyer UI, getFeatureFlags, and the order
    // create/create-direct server checks. The platform's own store (no tenant in scope) is treated as
    // own_delhivery=true and keeps COD on the site flag alone.
    try {
      const { resolveTenantId } = await import('./tenant-context')
      const tenantId = await resolveTenantId()
      if (tenantId) {
        const { controlPlanePool } = await import('./tenant-registry')
        const cp = await controlPlanePool().query(
          `SELECT own_delhivery FROM tenants WHERE id = $1`,
          [tenantId],
        )
        result.ownDelhivery = !!cp.rows[0]?.own_delhivery
        if (!result.ownDelhivery) result.flags.codEnabled = false
      } else {
        result.ownDelhivery = true
      }
    } catch {
      // Control-plane hiccup: fail closed on COD (and the toggle lock) so a platform-Delhivery tenant
      // can't collect COD it can't reconcile.
      result.ownDelhivery = false
      result.flags.codEnabled = false
    }

    // Stock validation is a Growth+ feature. On a tenant whose plan lacks inventory:read the
    // site-controls UI locks the toggle off, but the stored/default flag is otherwise true — so
    // force it off here at the source, matching the UI, so no consumer (order create, processing
    // transition, invoices, quotations, returns) enforces stock the tenant cannot manage.
    if (result.flags.inventoryValidationEnabled) {
      try {
        const { resolveTenantId } = await import('./tenant-context')
        const tenantId = await resolveTenantId()
        if (tenantId) {
          const { getTenantPlan } = await import('./plan-gate')
          const { scopes } = await getTenantPlan(tenantId)
          if (!scopes.has('inventory:read')) result.flags.inventoryValidationEnabled = false
        }
      } catch {
        // Control-plane hiccup: leave the stored flag as-is (the UI lock remains the backstop).
      }
    }

    cache.set(key, { value: result, expiresAt: Date.now() + TTL_MS })
    return result
  } catch {
    // Even the failure path must not hand a tenant the platform's identity.
    return { ...DEFAULTS, identity: await identityDefaults() }
  }
}

// Focused helpers so call sites read exactly what they need.
export async function getStoreIdentity(): Promise<StoreIdentity> {
  return (await getSiteControls()).identity
}
export async function getFeatureFlags(): Promise<FeatureFlags> {
  return (await getSiteControls()).flags
}
export async function getBusinessValues(): Promise<BusinessValues> {
  return (await getSiteControls()).values
}
export async function getStorefrontContent(): Promise<StorefrontContent> {
  return (await getSiteControls()).storefront
}

/** Clear the current tenant's entry, or every entry when called without a tenant in scope. */
export function invalidateSiteControlsCache() {
  const t = getCurrentTenant()
  if (t) cache.delete(t.tenantId)
  else cache.clear()
}

export { DEFAULTS as SITE_CONTROLS_DEFAULTS }
