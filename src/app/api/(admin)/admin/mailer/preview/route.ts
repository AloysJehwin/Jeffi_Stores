import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { renderCampaignEmail } from '@/lib/shared/email-campaigns'
import { previewVarMap, substituteVars } from '@/lib/shared/template-vars'

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'mailer:write'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { template_key, template_data, subject } = await request.json()
  if (!template_key) return NextResponse.json({ error: 'template_key required' }, { status: 400 })

  const sampleVars = previewVarMap()
  const subbedData: Record<string, string> = {}
  for (const [k, v] of Object.entries(template_data || {})) {
    subbedData[k] = typeof v === 'string' ? substituteVars(v, sampleVars) : (v as string)
  }
  const subbedSubject = substituteVars(subject || '', sampleVars)

  const { html } = renderCampaignEmail(
    template_key,
    { ...subbedData, subject: subbedSubject },
    sampleVars.customer_first_name
  )
  const subbedHtml = substituteVars(html, sampleVars)
  return NextResponse.json({ html: subbedHtml })
}
