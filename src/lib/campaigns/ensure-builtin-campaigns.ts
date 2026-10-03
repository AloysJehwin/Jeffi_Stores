import { query } from '@/lib/shared/db'
import { listScenarios } from './scenarios/_registry'

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

  // 2. a disabled campaign row per scenario.
  const values: string[] = []
  const params: unknown[] = []
  let i = 1
  for (const s of scenarios) {
    const subject = `${s.name} — a note for {firstName}`
    const body = `<p>Hi {firstName},</p><p>${s.description || s.name}</p>`
    values.push(`($${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, false)`)
    params.push(s.kind, s.name, s.description || null, s.kind, subject, body)
  }
  await query(
    `
    INSERT INTO campaigns (kind, name, description, scenario_kind, subject_template, body_template, enabled)
    VALUES ${values.join(', ')}
    ON CONFLICT (kind) DO NOTHING
    `,
    params
  ).catch(() => null)
}
