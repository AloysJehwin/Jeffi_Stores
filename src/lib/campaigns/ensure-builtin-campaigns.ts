import { query } from '@/lib/shared/db'
import { defaultCampaignSlugs } from '@/lib/campaigns/template-hints'
import { listScenarios } from './scenarios/_registry'
import { DEFAULT_COUPON_DISCOUNT, getBuiltinTemplate, RETIRED_BUILTIN_TEMPLATES } from './default-templates'
import { validateCampaignBodyTemplate } from './template-validation'

// The /admin/campaigns list renders rows from the `campaigns` table, but built-in scenarios live in the
// code registry. This upserts a `scenarios` registry row (campaigns.scenario_kind FKs to it) and then a
// DISABLED `campaigns` row for every registered scenario missing one, so the full catalogue shows up on
// the list and the cron can resolve it. Idempotent: ON CONFLICT DO NOTHING; never flips an existing row's
// enabled/templates/parameters. Not memoized — the query runs against whichever tenant DB the request's
// ALS context points at, so a process-global guard would wrongly skip other tenants.
export async function ensureBuiltinCampaignRows(): Promise<void> {
  const scenarios = listScenarios()
  if (scenarios.length === 0) return

  // 1. scenarios registry rows first — campaigns.scenario_kind has an FK to scenarios(kind).
  const scenVals: string[] = []
  const scenParams: unknown[] = []
  let si = 1
  for (const s of scenarios) {
    scenVals.push(`($${si++}, $${si++}, $${si++}, $${si++}::jsonb)`)
    scenParams.push(s.kind, s.name, s.description || null, JSON.stringify(s.defaultParams ?? {}))
  }
  await query(
    `
    INSERT INTO scenarios (kind, name, description, default_parameters)
    VALUES ${scenVals.join(', ')}
    ON CONFLICT (kind) DO NOTHING
    `,
    scenParams
  ).catch(() => null)

  // 2. a disabled campaign row per scenario, with its rich default template (images + coupon where
  //    relevant) and, for coupon kinds, a default discount (existing rows keep theirs). Fall back to a minimal valid body for any kind without a BUILTIN_TEMPLATES entry.
  const values: string[] = []
  const params: unknown[] = []
  let i = 1
  for (const s of scenarios) {
    const tpl = getBuiltinTemplate(s.kind)
    let subject = tpl?.subject || `${s.name} — a note for {firstName}`
    let body = tpl?.body || `<p>Hi {firstName},</p><p>${s.description || s.name}</p>`
    // Guard: if a template's tokens don't satisfy this kind's validation, fall back to a safe body so the
    // seed can never insert an invalid template.
    if (!validateCampaignBodyTemplate(body, { kind: s.kind, scenarioKind: s.kind }).ok) {
      subject = `${s.name} — a note for {firstName}`
      body = `<p style="font-size:16px;color:#333;margin:0 0 12px;">Hi {firstName},</p><p style="color:#555;line-height:1.6;">${s.description || s.name}</p><p style="margin:20px 0 0;"><a href="{ctaUrl}">Visit the store</a></p>`
    }
    const slugs = defaultCampaignSlugs(s.kind)
    values.push(`($${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, false, $${i++}, $${i++})`)
    params.push(s.kind, s.name, s.description || null, s.kind, subject, body, DEFAULT_COUPON_DISCOUNT[s.kind] ?? 0, slugs.email, slugs.sms)
  }
  await query(
    `
    INSERT INTO campaigns (kind, name, description, scenario_kind, subject_template, body_template, discount_percent, enabled, email_template_slug, sms_template_slug)
    VALUES ${values.join(', ')}
    ON CONFLICT (kind) DO NOTHING
    `,
    params
  ).catch(() => null)

  // 3. Move rows still on a retired default onto the current one. The exact-match guard means a
  //    template an admin has edited, even slightly, is never touched.
  for (const [kind, retired] of Object.entries(RETIRED_BUILTIN_TEMPLATES)) {
    const current = getBuiltinTemplate(kind)
    if (!current) continue
    for (const old of retired) {
      await query(
        `UPDATE campaigns SET subject_template = $2, body_template = $3, updated_at = NOW()
         WHERE kind = $1 AND subject_template = $4 AND body_template = $5`,
        [kind, current.subject, current.body, old.subject, old.body]
      ).catch(() => null)
    }
  }

  // 4. Same idea for parameters: a saved value equal to a retired default moves to the current
  //    default. Only that exact value is touched; anything an admin chose differently stays.
  for (const { kind, key, retired } of RETIRED_BUILTIN_PARAMS) {
    const current = scenarios.find(s => s.kind === kind)?.defaultParams?.[key]
    if (current === undefined) continue
    await query(
      `UPDATE campaigns SET parameters = jsonb_set(parameters, ARRAY[$2::text], to_jsonb($3::numeric)), updated_at = NOW()
       WHERE kind = $1 AND parameters ? $2 AND (parameters->>$2)::numeric = $4`,
      [kind, key, current, retired]
    ).catch(() => null)
  }
}

// winback_180's health cut of "under 25" could never match: the score doesn't go below ~29 for
// anyone who has ordered. Its default is now no cut.
const RETIRED_BUILTIN_PARAMS: { kind: string; key: string; retired: number }[] = [
  { kind: 'winback_180', key: 'healthScoreMax', retired: 25 },
]
