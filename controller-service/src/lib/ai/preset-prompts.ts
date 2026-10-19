// Preset prompt catalog + tenant-aware loader for the AI image/video modals.
// The GET route calls readPresets() to merge DEFAULT_PRESETS with tenant rows from
// public.ai_prompt_presets; the POST route calls writeTenantPreset() to add an override.
// Client components fetch via /api/admin/ai/preset-prompts and never import this module.

import { controlPlanePool } from '@/lib/tenant-registry/shared'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'

export type PresetKind = 'image' | 'video'

export interface Preset {
  kind: PresetKind
  feature?: string
  scenario: string
  prompt: string
  display_order?: number
  source?: 'default' | 'tenant'
}

// Platform defaults. Tenant rows in public.ai_prompt_presets override on
// (kind, feature, scenario); a tenant row with enabled=false hides the default.
// Prompt bodies carry {placeholders} the UI interpolates (default: strip).
export const DEFAULT_PRESETS: Preset[] = [
  // ----- image: product_image -----
  { kind: 'image', feature: 'product_image', scenario: 'studio_white',
    prompt: 'High-end studio photo of {productName} on seamless white, soft shadow, catalogue lighting, sharp focus.' },
  { kind: 'image', feature: 'product_image', scenario: 'lifestyle',
    prompt: 'Lifestyle scene with {productName} in a bright, uncluttered room, warm daylight, shallow depth of field.' },
  { kind: 'image', feature: 'product_image', scenario: 'detail_macro',
    prompt: 'Macro shot of {productName} highlighting {featureHighlight}; dramatic rim light, textured surface, crisp focus.' },
  // ----- image: social_image -----
  { kind: 'image', feature: 'social_image', scenario: 'promo_square',
    prompt: 'Vibrant 1:1 social promo for {productName} with bold typography space on the left, brand accent {brandAccent}, playful background.' },
  { kind: 'image', feature: 'social_image', scenario: 'story_portrait',
    prompt: 'Story-ready 9:16 of {productName}, soft gradient background in {brandAccent}, generous negative space at the top for copy.' },
  // ----- image: hero_image -----
  { kind: 'image', feature: 'hero_image', scenario: 'homepage_banner',
    prompt: 'Wide site hero banner featuring {productName}; cinematic lighting, brand accent {brandAccent}, subject left with headline room on the right.' },
  { kind: 'image', feature: 'hero_image', scenario: 'collection_header',
    prompt: 'Editorial collection header grouping {colorVariants} of {productName}, soft shadows, uniform pastel backdrop.' },
  // ----- image: offer_image -----
  { kind: 'image', feature: 'offer_image', scenario: 'discount_badge',
    prompt: 'Bold discount visual for {productName} with a ribbon in {brandAccent}, confetti accents, high contrast tuned for mobile.' },
  { kind: 'image', feature: 'offer_image', scenario: 'festive',
    prompt: 'Festive seasonal composition around {productName}, warm lights, garland or floral motifs, brand accent {brandAccent}.' },
  // ----- image: email_hero -----
  { kind: 'image', feature: 'email_hero', scenario: 'newsletter_banner',
    prompt: 'Clean email header banner for {productName}; wide 2:1 aspect, subtle brand gradient {brandAccent}, large copy-safe area on the right.' },
  // ----- image: ads_image -----
  { kind: 'image', feature: 'ads_image', scenario: 'performance_square',
    prompt: 'Scroll-stopping square ad for {productName} calling out {featureHighlight}; punchy colors, isolated subject, product-left copy-right layout.' },
  // ----- image: meta_ads_image -----
  { kind: 'image', feature: 'meta_ads_image', scenario: 'carousel_slide',
    prompt: 'Carousel-ready square of {productName} on a bright pastel wash with soft shadow and a visible brand accent {brandAccent}.' },
  // ----- image: globals (no feature) -----
  { kind: 'image', scenario: 'brand_mood',
    prompt: 'Brand mood board for {productName}: three complementary swatches of {brandAccent}, textures, soft natural light.' },
  { kind: 'image', scenario: 'minimal_flatlay',
    prompt: 'Minimalist flat lay of {productName} with simple geometric props, muted palette, overhead view.' },

  // ----- video: social_video -----
  { kind: 'video', feature: 'social_video', scenario: 'product_spin',
    prompt: 'Slow 360-degree turntable of {productName} on a seamless backdrop, soft studio key light, loopable.' },
  { kind: 'video', feature: 'social_video', scenario: 'lifestyle_vignette',
    prompt: 'Short lifestyle vignette of {productName} used in a cozy daylit room, handheld feel, warm color grade.' },
  { kind: 'video', feature: 'social_video', scenario: 'reveal',
    prompt: 'Dynamic reveal of {productName}: silk cover slides away to show the product, dramatic lighting in {brandAccent}.' },
  { kind: 'video', feature: 'social_video', scenario: 'unbox',
    prompt: 'Overhead unboxing moment: hands open a branded box to reveal {productName}; crisp, satisfying motion.' },
  { kind: 'video', feature: 'social_video', scenario: 'before_after',
    prompt: 'Before-and-after transition showing {productName} delivering {featureHighlight}; split screen with a bright pop on reveal.' },
  { kind: 'video', feature: 'social_video', scenario: 'macro_zoom',
    prompt: 'Slow macro push-in on {productName}, revealing texture and craftsmanship, cinematic depth of field.' },
  { kind: 'video', feature: 'social_video', scenario: 'testimonial_bg',
    prompt: 'Looping subtle background with {productName} softly out of focus, slow pan, brand accent {brandAccent} haze for a testimonial overlay.' },
  { kind: 'video', feature: 'social_video', scenario: 'seasonal_highlight',
    prompt: 'Seasonal highlight reel of {productName} with falling confetti or petals in {brandAccent}, warm cinematic grade.' },
  // ----- video: globals (no feature) -----
  { kind: 'video', scenario: 'logo_flourish',
    prompt: 'Elegant logo flourish motion with {brandAccent} ribbons sweeping in, finishing on {productName}.' },
  { kind: 'video', scenario: 'cinematic_pan',
    prompt: 'Cinematic slow pan over {productName} on a dark backdrop, god-ray lighting, 24fps film look.' },
  { kind: 'video', scenario: 'studio_rotate',
    prompt: 'Studio turntable rotation of {productName}, white seamless, soft diffused light, matte finish.' },
  { kind: 'video', scenario: 'lifestyle_crowd',
    prompt: 'Lifestyle B-roll of {productName} in a candid cafe scene, out-of-focus crowd behind, late-afternoon light.' },
]

export interface ReadPresetsOpts {
  kind: PresetKind
  /** When set, only presets with this feature (or no feature) are returned. */
  feature?: string | null
}

interface Row {
  tenant_id: string | null
  feature: string | null
  scenario: string
  prompt: string
  display_order: number
  enabled: boolean
}

function keyOf(kind: PresetKind, feature: string | null | undefined, scenario: string) {
  return `${kind}|${feature ?? ''}|${scenario}`
}

/**
 * Return the merged preset list for the resolved tenant. Tenant rows win on
 * (kind, feature, scenario); enabled=false hides the default; display_order sets order.
 * Falls back to DEFAULT_PRESETS when the DB table is missing or the SELECT fails.
 */
export async function readPresets(opts: ReadPresetsOpts): Promise<Preset[]> {
  const { kind, feature = null } = opts
  const tenantId = await resolveTenantId()

  const defaults = DEFAULT_PRESETS.filter(
    p => p.kind === kind && (!feature || !p.feature || p.feature === feature),
  )

  let rows: Row[] = []
  try {
    const r = await controlPlanePool().query<Row>(
      `SELECT tenant_id, feature, scenario, prompt, display_order, enabled
         FROM public.ai_prompt_presets
        WHERE kind = $1
          AND ($2::text IS NULL OR feature IS NULL OR feature = $2::text)
          AND (tenant_id IS NULL OR tenant_id = $3::uuid)`,
      [kind, feature, tenantId],
    )
    rows = r.rows
  } catch {
    return defaults.map((p, i) => ({ ...p, display_order: p.display_order ?? 100 + i, source: 'default' }))
  }

  // Tenant rows override on (kind, feature, scenario); platform rows feed through.
  const tenantOverride = new Map<string, Row>()
  const platformRows = new Map<string, Row>()
  for (const row of rows) {
    const k = keyOf(kind, row.feature, row.scenario)
    if (row.tenant_id) tenantOverride.set(k, row)
    else platformRows.set(k, row)
  }

  const merged = new Map<string, Preset>()
  defaults.forEach((p, i) => {
    merged.set(keyOf(p.kind, p.feature ?? null, p.scenario), {
      ...p,
      display_order: p.display_order ?? 100 + i,
      source: 'default',
    })
  })
  for (const [k, row] of platformRows) {
    merged.set(k, {
      kind,
      feature: row.feature ?? undefined,
      scenario: row.scenario,
      prompt: row.prompt,
      display_order: row.display_order,
      source: 'default',
    })
  }
  for (const [k, row] of tenantOverride) {
    if (!row.enabled) {
      merged.delete(k)
      continue
    }
    merged.set(k, {
      kind,
      feature: row.feature ?? undefined,
      scenario: row.scenario,
      prompt: row.prompt,
      display_order: row.display_order,
      source: 'tenant',
    })
  }

  return [...merged.values()].sort((a, b) => {
    const da = a.display_order ?? 100
    const db = b.display_order ?? 100
    if (da !== db) return da - db
    return a.scenario.localeCompare(b.scenario)
  })
}

export interface WriteTenantPresetInput {
  kind: PresetKind
  feature?: string | null
  scenario: string
  prompt: string
  display_order?: number
  enabled?: boolean
  createdBy?: string | null
}

/**
 * Upsert a tenant-override row. Requires a resolved tenant; the caller route gates on
 * settings:write. The unique index is on COALESCE(tenant_id,...), kind, COALESCE(feature,''), scenario.
 */
export async function writeTenantPreset(input: WriteTenantPresetInput): Promise<{ id: string }> {
  const tenantId = await resolveTenantId()
  if (!tenantId) throw new Error('No tenant resolved')
  const feature = input.feature ?? null
  const display_order = input.display_order ?? 100
  const enabled = input.enabled ?? true

  // UPDATE first, INSERT when absent. Uses IS NOT DISTINCT FROM so NULL feature compares equal.
  const res = await controlPlanePool().query<{ id: string }>(
    `WITH updated AS (
       UPDATE public.ai_prompt_presets
          SET prompt = $5, display_order = $6, enabled = $7, updated_at = now()
        WHERE kind = $2 AND tenant_id = $1
          AND feature IS NOT DISTINCT FROM $3::text
          AND scenario = $4
        RETURNING id
     ),
     inserted AS (
       INSERT INTO public.ai_prompt_presets (tenant_id, kind, feature, scenario, prompt, display_order, enabled, created_by)
       SELECT $1, $2, $3::text, $4, $5, $6, $7, $8
        WHERE NOT EXISTS (SELECT 1 FROM updated)
       RETURNING id
     )
     SELECT id FROM updated UNION ALL SELECT id FROM inserted`,
    [tenantId, input.kind, feature, input.scenario, input.prompt, display_order, enabled, input.createdBy ?? null],
  )
  return { id: res.rows[0]?.id ?? '' }
}

/** Default interpolator: strip remaining {placeholders}. Client can pass a vars map instead. */
export function interpolatePreset(prompt: string, vars?: Record<string, string | undefined | null>): string {
  if (!vars) return prompt.replace(/\{[a-zA-Z0-9_]+\}/g, '').replace(/\s{2,}/g, ' ').trim()
  return prompt
    .replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, key) => {
      const v = vars[key]
      return v == null || v === '' ? '' : String(v)
    })
    .replace(/\s{2,}/g, ' ')
    .trim()
}
