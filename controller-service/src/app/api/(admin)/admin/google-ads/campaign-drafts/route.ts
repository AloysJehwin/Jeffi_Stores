import { jsonDraftCollection } from '@/lib/admin/json-drafts'
import { ADS_CAMPAIGN_DRAFTS } from '@/lib/google-ads/campaign-drafts'

export const dynamic = 'force-dynamic'

// GET — every unfinished new-campaign wizard; POST { title?, fields } — start one (its creator holds the lock).
const r = jsonDraftCollection(ADS_CAMPAIGN_DRAFTS)
export const GET = r.GET
export const POST = r.POST
