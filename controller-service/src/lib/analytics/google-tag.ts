// Per-store Google tag / Ads conversion settings and the inline gtag bootstrap (Consent Mode v2).
// Pure and isomorphic: used by the root layout, the settings API and the admin form.

export const FLAGSHIP_GOOGLE_TAG_ID = 'GT-NM2C3M85'
export const CONSENT_COOKIE = 'jeffi_consent'

export const GOOGLE_TAG_SETTING_KEYS = [
  'google_tag_id',
  'google_ads_conversion_id',
  'google_ads_conversion_label',
] as const
export type GoogleTagSettingKey = (typeof GOOGLE_TAG_SETTING_KEYS)[number]

const TAG_ID_RE = /^(GT|G|AW)-[A-Z0-9]{4,20}$/
const CONVERSION_ID_RE = /^AW-\d{6,15}$/
const CONVERSION_LABEL_RE = /^[A-Za-z0-9_-]{6,64}$/

/** Normalises a setting value; returns an error message when it is not a valid value for the key. Empty clears it. */
export function validateGoogleTagSetting(
  key: GoogleTagSettingKey,
  raw: unknown
): { ok: true; value: string } | { ok: false; error: string } {
  const v = String(raw ?? '').trim()
  if (!v) return { ok: true, value: '' }
  if (key === 'google_tag_id') {
    const u = v.toUpperCase()
    return TAG_ID_RE.test(u)
      ? { ok: true, value: u }
      : { ok: false, error: 'Google tag ID must look like GT-XXXXXXX, G-XXXXXXXXXX or AW-123456789.' }
  }
  if (key === 'google_ads_conversion_id') {
    const u = v.toUpperCase()
    return CONVERSION_ID_RE.test(u)
      ? { ok: true, value: u }
      : { ok: false, error: 'Conversion ID must look like AW-123456789.' }
  }
  return CONVERSION_LABEL_RE.test(v)
    ? { ok: true, value: v }
    : { ok: false, error: 'Conversion label is the part after the slash in send_to, e.g. AbC-D_efG-h12_34-567.' }
}

export function isGoogleTagSettingKey(key: string): key is GoogleTagSettingKey {
  return (GOOGLE_TAG_SETTING_KEYS as readonly string[]).includes(key)
}

export interface GoogleTagConfig {
  /** IDs to `gtag('config', …)`; the first one is the loader id. Empty = load nothing. */
  tagIds: string[]
  /** `send_to` for the Ads purchase conversion, or null. */
  conversionSendTo: string | null
}

/** Flagship falls back to its historical tag; a tenant with no tag of its own loads nothing. */
export function resolveGoogleTag(input: {
  tagId: string
  conversionId: string
  conversionLabel: string
  isTenant: boolean
}): GoogleTagConfig {
  const valid = (k: GoogleTagSettingKey, v: string) => {
    const r = validateGoogleTagSetting(k, v)
    return r.ok ? r.value : ''
  }
  const tagId = valid('google_tag_id', input.tagId) || (input.isTenant ? '' : FLAGSHIP_GOOGLE_TAG_ID)
  const conversionId = valid('google_ads_conversion_id', input.conversionId)
  const conversionLabel = valid('google_ads_conversion_label', input.conversionLabel)
  const tagIds = [tagId, conversionId].filter((id, i, a) => id && a.indexOf(id) === i)
  return {
    tagIds,
    conversionSendTo: conversionId && conversionLabel ? `${conversionId}/${conversionLabel}` : null,
  }
}

/**
 * Inline gtag bootstrap. With consentMode, every storage type is denied until the visitor
 * chooses; a stored choice (consent cookie) is applied before any config fires.
 */
export function gtagBootstrapScript(cfg: GoogleTagConfig, consentMode: boolean): string {
  const lines = ['window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}window.gtag=gtag;']
  if (consentMode) {
    lines.push(
      "gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied',wait_for_update:500});",
      "gtag('set','ads_data_redaction',true);window.jeffiConsent=true;",
      `try{var m=document.cookie.match(/(?:^|; )${CONSENT_COOKIE}=([^;]*)/);if(m){var p=decodeURIComponent(m[1]).split('.');if(p[0]==='v1'){var a=p[1]==='1'?'granted':'denied',d=p[2]==='1'?'granted':'denied';gtag('consent','update',{analytics_storage:a,ad_storage:d,ad_user_data:d,ad_personalization:d})}}}catch(e){}`
    )
  }
  lines.push(`window.jeffiAds=${JSON.stringify({ sendTo: cfg.conversionSendTo })};`)
  lines.push("gtag('js',new Date());")
  for (const id of cfg.tagIds) lines.push(`gtag('config',${JSON.stringify(id)});`)
  return lines.join('')
}
