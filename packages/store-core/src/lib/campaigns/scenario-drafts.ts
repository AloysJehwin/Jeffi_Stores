import type { JsonDraftConfig } from '@/lib/admin/json-drafts'

export const SCENARIO_DRAFTS: JsonDraftConfig = {
  table: 'scenario_drafts',
  type: 'scenario',
  readScope: 'campaigns:read',
  writeScope: 'campaigns:write',
  noun: 'scenario draft',
  listColumns: `d.fields->>'name' AS name, d.fields->>'step' AS step`,
}

// An unfinished new-scenario wizard: what was typed and generated, kept until the scenario is saved.
export interface ScenarioDraftFields {
  step?: 'describe' | 'review_sql' | 'dry_run' | 'save'
  aiPrompt?: string
  sql?: string
  productSql?: string
  explanation?: string
  validation?: unknown
  productValidation?: unknown
  dryRun?: unknown
  name?: string
  kind?: string
  description?: string
}
