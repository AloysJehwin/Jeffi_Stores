'use server'

import { redirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { query, queryOne } from '@/lib/shared/db'
import { draftEditUrl, tryAcquireForAction } from '@/lib/admin/draft-locks'

// Create (or reuse) an edit-draft for the campaign kind, then redirect to /edit.
// Mirrors startCouponDraft / startBrandDraft. The edit page's own guard sends
// users back here when no draft exists, so this is the single entry to editing.
// Fields selected mirror the editor form shape (CampaignDetailClient) so a brand-new
// draft already carries the live values when the admin lands on /edit.
export async function startCampaignDraft(kind: string, formData: FormData) {
  const back = (formData.get('_back') as string | null) || null
  await query(
    `INSERT INTO campaign_drafts (kind, fields, updated_at)
     SELECT c.kind,
       jsonb_strip_nulls(jsonb_build_object(
         'enabled', c.enabled,
         'delay_hours', c.delay_hours,
         'discount_percent', c.discount_percent,
         'coupon_id', c.coupon_id,
         'scenario_kind', c.scenario_kind,
         'subject_template', c.subject_template,
         'body_template', c.body_template,
         'template_layout', c.template_layout,
         'template_mode', c.template_mode,
         'blocks', c.blocks,
         'sms_template', c.sms_template,
         'wa_template_sid', c.wa_template_sid,
         'wa_variables', c.wa_variables,
         'wa_header_image_url', c.wa_header_image_url,
         'email_template_slug', c.email_template_slug,
         'sms_template_slug', c.sms_template_slug,
         'wa_template_slug', c.wa_template_slug,
         'parameters', c.parameters
       )),
       now()
     FROM campaigns c WHERE c.kind = $1
     ON CONFLICT (kind) DO UPDATE
       SET fields = EXCLUDED.fields, updated_at = now()
       WHERE campaign_drafts.fields = '{}'::jsonb`,
    [kind]
  )
  const row = await queryOne<{ campaign_id: string }>(`SELECT campaign_id FROM campaign_drafts WHERE kind = $1`, [kind])
  // Someone else's draft opens read-only (the seed above never overwrites a started draft).
  const mine = row ? await tryAcquireForAction('campaign', row.campaign_id) : true
  const host = await getHost()
  redirect(ap(draftEditUrl(`/admin/campaigns/${kind}/edit`, back, mine), host))
}
