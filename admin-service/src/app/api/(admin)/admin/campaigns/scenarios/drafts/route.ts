import { jsonDraftCollection } from '@/lib/admin/json-drafts'
import { SCENARIO_DRAFTS } from '@/lib/campaigns/scenario-drafts'

export const dynamic = 'force-dynamic'

// GET — every unfinished new-scenario wizard; POST { title?, fields } — start one (its creator holds the lock).
const r = jsonDraftCollection(SCENARIO_DRAFTS)
export const GET = r.GET
export const POST = r.POST
