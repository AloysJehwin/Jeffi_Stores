import { NextRequest, NextResponse } from 'next/server'
import { outreachGuard, serverError } from '@controller/lib/outreach/guard'
import { catalogSummary } from '@controller/lib/outreach/agent/catalog'
import { HARD_LIMITS } from '@controller/lib/outreach/agent/limits'
import { PLACEHOLDERS } from '@controller/lib/outreach/agent/skill/render'
import { CHANNELS, FLOWS } from '@controller/lib/outreach/agent/types'

export const dynamic = 'force-dynamic'

// GET → what a skill can use: the tool catalog, the hard limits, the placeholders, the channels and flows.
export async function GET(req: NextRequest) {
  const admin = await outreachGuard(req, 'read')
  if (admin instanceof NextResponse) return admin
  try {
    return NextResponse.json({ tools: catalogSummary(), limits: HARD_LIMITS, placeholders: PLACEHOLDERS, channels: CHANNELS, flows: FLOWS })
  } catch (e) {
    return serverError(e)
  }
}
