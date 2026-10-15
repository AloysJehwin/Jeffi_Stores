import { NextRequest, NextResponse } from 'next/server'
import { verifyCronRequest } from '@/lib/shared/cron-auth'
import { runAiHealthCheck, recordAiHealth } from '@/lib/shared/ai-health'

export const dynamic = 'force-dynamic'

// ai_health cron (every 5 min): real gateway chat + direct Ollama check; alerts once per incident.
// 503 when unhealthy so the cron status page shows it too. Auth: Bearer ${CRON_SECRET}.
export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const result = await runAiHealthCheck()
  const incident = await recordAiHealth(result)
  return NextResponse.json({ ...result, incident }, { status: result.ok ? 200 : 503 })
}
