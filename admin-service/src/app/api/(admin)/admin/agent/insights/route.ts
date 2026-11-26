import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { getInsightsSeries } from '@/lib/queries'
import { parseInsightsQuery } from '@/lib/insights/series'

export const dynamic = 'force-dynamic'

const TOOL_CALLS = `SUM(CASE WHEN jsonb_typeof(m.tool_calls) = 'array' THEN jsonb_array_length(m.tool_calls) ELSE 0 END)`

// Daily agent conversations (distinct ones that got a question) against the tool calls the agent made,
// behind the agent Overview's insights sheet. Same gate as the agent overview API.
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'agent:read')
  if (admin instanceof NextResponse) return admin
  const q = parseInsightsQuery(request.nextUrl.searchParams)
  if (!q.ok) return NextResponse.json({ error: q.error }, { status: 400 })
  try {
    const series = await getInsightsSeries({
      table: 'admin_agent_messages',
      alias: 'm',
      dateColumn: 'created_at',
      series: [
        { key: 'conversations', label: 'Conversations', value: 'COUNT(DISTINCT m.conversation_id)', where: `m.role = 'user'` },
        { key: 'tool_calls', label: 'Tool calls', value: TOOL_CALLS, where: `m.role = 'assistant'` },
      ],
      weeks: q.weeks,
    })
    return NextResponse.json({ series })
  } catch (err) {
    console.error('[agent insights]', err)
    return NextResponse.json({ error: 'Failed to load insights' }, { status: 500 })
  }
}
