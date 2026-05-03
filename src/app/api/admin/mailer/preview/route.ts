import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { renderCampaignEmail } from '@/lib/email-campaigns'

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { template_key, template_data, subject } = await request.json()
  if (!template_key) return NextResponse.json({ error: 'template_key required' }, { status: 400 })

  const { html } = renderCampaignEmail(template_key, { ...template_data, subject }, 'Preview Customer')
  return NextResponse.json({ html })
}
