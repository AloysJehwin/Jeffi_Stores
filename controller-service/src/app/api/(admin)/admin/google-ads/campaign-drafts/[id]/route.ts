import { jsonDraftItem } from '@/lib/admin/json-drafts'
import { ADS_CAMPAIGN_DRAFTS } from '@/lib/google-ads/campaign-drafts'

export const dynamic = 'force-dynamic'

const r = jsonDraftItem(ADS_CAMPAIGN_DRAFTS)
export const GET = r.GET
export const PATCH = r.PATCH
export const DELETE = r.DELETE
