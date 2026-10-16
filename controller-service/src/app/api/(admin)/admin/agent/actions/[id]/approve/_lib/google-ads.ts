import { AGENT_ADS_ACTIONS } from '@/lib/admin-agent/tools/google-ads'
import { callInternalApi } from './shared'
import type { AgentAction, ActionResult } from './shared'

// An approved Google Ads proposal goes through the console's manage endpoint as the approving
// admin, so the same scope (google_ads_campaigns:write), plan gate, Google validation and change
// log apply as for a click in the console.
export async function runGoogleAdsAction(action: AgentAction, cookieHeader: string): Promise<ActionResult> {
  const body = action.payload?.body
  if (!body || typeof body !== 'object' || !(AGENT_ADS_ACTIONS as readonly string[]).includes(String(body.action))) {
    return { result: null, error: 'Unsupported Google Ads change' }
  }
  const r = await callInternalApi(cookieHeader, 'POST', '/api/admin/google-ads/manage', { ...body, preview: false })
  if (!r.ok) return { result: null, error: r.data?.error || `Google Ads change failed (HTTP ${r.status})` }
  return { result: { summary: r.data?.summary ?? action.payload?.summary ?? null, refreshError: r.data?.refreshError ?? null }, error: null }
}
