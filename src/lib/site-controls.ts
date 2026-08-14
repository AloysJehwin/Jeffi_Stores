import { queryMany } from './db'

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
  logoUrl: string   // '' means "use the static /images/logo.png fallback"
}

export interface FeatureFlags {
  razorpayEnabled: boolean
  gstEnabled: boolean
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
  delhiveryOriginPincode: string
  businessStateCode: string
  defaultProductWeightG: number
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
}

export interface SiteControls {
  identity: StoreIdentity
  flags: FeatureFlags
  values: BusinessValues
  storefront: StorefrontContent
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
    gstEnabled: envBool(process.env.ENABLE_GST),
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
    delhiveryOriginPincode: process.env.DELHIVERY_ORIGIN_PINCODE || '492001',
    businessStateCode: process.env.BUSINESS_STATE_CODE || '22',
    defaultProductWeightG: 500,
    pickupLocation: process.env.DELHIVERY_PICKUP_LOCATION || 'Jeffi Stores',
    sellerName: process.env.DELHIVERY_SELLER_NAME || 'Jeffi Stores',
    sellerAddress: process.env.DELHIVERY_SELLER_ADDRESS || 'Near Arihant Complex, Sanjay Gandhi Chowk, Station Road, Raipur',
    sellerPhone: process.env.DELHIVERY_SELLER_PHONE || '07713585374',
  },
  storefront: {
    featuredLimit: 8,
    newArrivalsLimit: 4,
    statsJson: '',
    aboutCopy: '',
  },
}

const KEYS = [
  'business_name', 'business_email', 'business_phone', 'business_web', 'business_logo_url',
  'feature_razorpay_enabled', 'feature_gst_enabled',
  'feature_ondevice_summary_enabled', 'feature_ondevice_finetune_enabled',
  'feature_ondevice_summary_mobile_enabled', 'feature_ondevice_summary_desktop_enabled',
  'feature_ondevice_finetune_mobile_enabled', 'feature_ondevice_finetune_desktop_enabled',
  'cod_surcharge_flat', 'cod_surcharge_pct', 'shipping_min_charge', 'shipping_max_charge',
  'order_auto_cancel_minutes', 'delhivery_origin_pincode', 'business_state_code',
  'default_product_weight_g',
  'delhivery_pickup_location', 'delhivery_seller_name', 'delhivery_seller_address', 'delhivery_seller_phone',
  'storefront_featured_limit', 'storefront_new_arrivals_limit',
  'storefront_stats_json', 'storefront_about_copy',
]

let cache: { value: SiteControls; expiresAt: number } | null = null
const TTL_MS = 30 * 1000

export async function getSiteControls(): Promise<SiteControls> {
  if (cache && Date.now() < cache.expiresAt) return cache.value

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
    const result: SiteControls = {
      identity: {
        name: str('business_name', d.identity.name),
        email: str('business_email', d.identity.email),
        phone: str('business_phone', d.identity.phone),
        web: str('business_web', d.identity.web),
        logoUrl: str('business_logo_url', d.identity.logoUrl),
      },
      flags: {
        razorpayEnabled: bool('feature_razorpay_enabled', d.flags.razorpayEnabled),
        gstEnabled: bool('feature_gst_enabled', d.flags.gstEnabled),
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
        delhiveryOriginPincode: str('delhivery_origin_pincode', d.values.delhiveryOriginPincode),
        businessStateCode: str('business_state_code', d.values.businessStateCode),
        defaultProductWeightG: Math.max(1, num('default_product_weight_g', d.values.defaultProductWeightG)),
        pickupLocation: str('delhivery_pickup_location', d.values.pickupLocation),
        sellerName: str('delhivery_seller_name', d.values.sellerName),
        sellerAddress: str('delhivery_seller_address', d.values.sellerAddress),
        sellerPhone: str('delhivery_seller_phone', d.values.sellerPhone),
      },
      storefront: {
        featuredLimit: Math.max(1, Math.round(num('storefront_featured_limit', d.storefront.featuredLimit))),
        newArrivalsLimit: Math.max(1, Math.round(num('storefront_new_arrivals_limit', d.storefront.newArrivalsLimit))),
        statsJson: str('storefront_stats_json', d.storefront.statsJson),
        aboutCopy: str('storefront_about_copy', d.storefront.aboutCopy),
      },
    }

    cache = { value: result, expiresAt: Date.now() + TTL_MS }
    return result
  } catch {
    return DEFAULTS
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

export function invalidateSiteControlsCache() {
  cache = null
}

export { DEFAULTS as SITE_CONTROLS_DEFAULTS }
