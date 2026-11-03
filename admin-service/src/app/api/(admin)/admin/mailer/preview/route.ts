import { storeBaseUrlAsync } from '@/lib/catalog/brand'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { renderCampaignEmail, baseLayout } from '@/lib/shared/email-campaigns'
import { renderCampaignTemplate } from '@/lib/shared/automation-emails'
import { getLibraryTemplate } from '@/lib/messaging/library'
import { renderBlocks } from '@/lib/templates/blocks'
import { resolveTemplateVariables, sampleVariableMap, renderTemplate } from '@/lib/templates/variables'

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'mailer:write'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { template_key, template_data, subject, channels } = await request.json()
  if (!template_key) return NextResponse.json({ error: 'template_key required' }, { status: 400 })

  // Real store values and custom variables; a sample customer.
  const sample = sampleVariableMap()
  const vars = await resolveTemplateVariables({
    recipient: {
      email: sample.customer_email,
      first_name: sample.customer_first_name,
      last_name: sample.customer_last_name,
    },
  })
  const subbedSubject = renderTemplate(subject || '', vars)

  if (template_key === 'library') {
    const email = channels?.email
    if (!email?.slug) return NextResponse.json({ html: '' })
    const t = await getLibraryTemplate('email', email.slug)
    if (!t) return NextResponse.json({ html: '' })
    const body = (t.blocks_format === 'email-blocks' && Array.isArray(t.blocks?.blocks) && renderBlocks(t.blocks.blocks)) || t.body
    const scenario = { firstName: vars.customer_first_name || 'there', ...(email.vars || {}) }
    const subj = renderCampaignTemplate(email.subject || t.subject || subject || '', scenario, vars, false)
    const html = renderTemplate(baseLayout(subj, renderCampaignTemplate(body, scenario, vars, true), await storeBaseUrlAsync()), vars, { escape: true })
    return NextResponse.json({ html, subject: subj })
  }

  // Same base the real send uses, so a tenant's preview shows its own store's links.
  const { html } = renderCampaignEmail(
    template_key,
    { ...(template_data || {}), subject: subbedSubject },
    vars.customer_first_name,
    await storeBaseUrlAsync(),
    vars.store_name,
    vars
  )
  return NextResponse.json({ html })
}
