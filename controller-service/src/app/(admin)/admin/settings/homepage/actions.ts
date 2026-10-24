'use server'

import { redirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { query } from '@/lib/shared/db'
import { getAdminSession } from '@/lib/auth/admin-auth'
import { findOpenSession, resnapshotSession } from '@/lib/admin/editor-sessions'

// Resnapshot the admin's open homepage session to the current draft. Called by
// the explicit "Save as Draft" button so a later Cancel reverts to A2 (the
// just-saved draft) rather than A1 (the pre-session snapshot). Never fails the
// caller — autosaves still succeed if resnapshot fails.
export async function resnapshotHomepageSession() {
  try {
    const session = await getAdminSession()
    if (!session) return
    // Homepage sessions key resource_id by the admin's own uuid (singleton draft).
    const open = await findOpenSession(session.adminId, 'homepage', session.adminId)
    if (!open) return
    await resnapshotSession(open.id, session.adminId)
  } catch (err) {
    console.error('[homepage-edit] resnapshotSession failed', err)
  }
}

// Create (or reuse) the homepage draft row from live state, then redirect back
// to the homepage editor. Kept parallel with startCouponDraft / startBrandDraft
// for consistency even though homepage has no separate /view page: the draft is
// implicit, created on first mutation. ON CONFLICT DO NOTHING is safe.
export async function startHomepageDraft(formData: FormData) {
  const session = await getAdminSession()
  await query(
    `INSERT INTO homepage_drafts (id, sections, hero_slides, updated_by)
     SELECT true,
            COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.display_order, t.created_at) FROM homepage_sections t), '[]'::jsonb),
            COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.display_order, t.created_at) FROM hero_slides t), '[]'::jsonb),
            $1::uuid
     ON CONFLICT (id) DO NOTHING`,
    [session?.adminId ?? null]
  )
  const host = await getHost()
  const surface = formData.get('surface') === 'app' ? '?surface=app' : ''
  redirect(`${ap('/admin/settings/homepage', host)}${surface}`)
}
