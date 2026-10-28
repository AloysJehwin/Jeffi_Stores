import type { JsonDraftConfig } from '@/lib/admin/json-drafts'

// New-campaign wizard drafts: fields = { draft, ext, step } (the wizard's own state shapes).
export const ADS_CAMPAIGN_DRAFTS: JsonDraftConfig = {
  table: 'ads_campaign_drafts',
  type: 'google_ads_campaign',
  readScope: 'google_ads:read',
  writeScope: 'google_ads_campaigns:write',
  noun: 'campaign draft',
  listColumns: `d.fields->'draft'->>'type' AS campaign_type, (d.fields->>'step')::int AS step`,
}
