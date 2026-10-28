import { jsonDraftItem } from '@/lib/admin/json-drafts'
import { SCENARIO_DRAFTS } from '@/lib/campaigns/scenario-drafts'

export const dynamic = 'force-dynamic'

const r = jsonDraftItem(SCENARIO_DRAFTS)
export const GET = r.GET
export const PATCH = r.PATCH
export const DELETE = r.DELETE
