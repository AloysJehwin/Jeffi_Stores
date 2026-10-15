import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne } from '@/lib/shared/db'
import { runScenario } from '@/lib/campaigns/runner'
import { getScenario } from '@/lib/campaigns/scenarios/_registry'
import { runCustomScenario } from '@/lib/campaigns/custom-runner'
import { getCampaign } from '@/lib/shared/marketing'
import type { SweepResult } from '@/lib/campaigns/types'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'mailer:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  // Run the sweep IN-PROCESS under the current tenant context (the admin request already resolved the
  // tenant). The old implementation did an HTTP self-call to the tenant's storefront host, which 404s
  // locally and can't carry tenant identity — the source of the "Not found is not valid JSON" error.
  try {
    const row = await queryOne<{ scenario_kind: string | null; enabled: boolean }>(
      `SELECT scenario_kind, enabled FROM campaigns WHERE kind = $1`,
      [kind]
    )
    if (!row) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    if (!row.enabled) {
      return NextResponse.json({ error: 'Enable the campaign before running it.' }, { status: 400 })
    }

    const scenarioKind = row.scenario_kind || kind
    let result: SweepResult
    const builtin = getScenario(scenarioKind)
    if (builtin) {
      result = await runScenario(builtin, kind)
    } else {
      const isCustom = await queryOne<{ enabled: boolean }>(`SELECT enabled FROM custom_scenarios WHERE kind = $1`, [
        scenarioKind,
      ])
      if (!isCustom?.enabled) {
        return NextResponse.json({ error: 'No runnable scenario for this campaign.' }, { status: 400 })
      }
      const campaign = await getCampaign(kind)
      if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
      result = await runCustomScenario(scenarioKind, campaign)
    }

    if (result.error) {
      return NextResponse.json({ error: result.error, totalSent: result.sent, result }, { status: 500 })
    }
    return NextResponse.json({ success: true, totalSent: result.sent, result })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Run failed' }, { status: 500 })
  }
}
