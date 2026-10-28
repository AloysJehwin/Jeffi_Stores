'use server'

import { redirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { getAdminSession } from '@/lib/auth/admin-auth'
import { findOpenSession, resnapshotSession } from '@/lib/admin/editor-sessions'
import { HOMEPAGE_ENTITY_ID, actionActor, tryAcquireForAction } from '@/lib/admin/draft-locks'
import { draftsOf } from '@/lib/admin/draft-branches'
import { createHomepageDraft, homepageDrafts } from '@/lib/catalog/homepage-draft'

// Resnapshot the admin's open session on this draft. Called by the explicit "Save as Draft" button
// so a later Cancel reverts to the just-saved draft rather than the pre-session snapshot. Never
// fails the caller: autosaves still succeed if resnapshot fails.
export async function resnapshotHomepageSession(draftId: string) {
  try {
    const session = await getAdminSession()
    if (!session) return
    const open = await findOpenSession(session.adminId, 'homepage', draftId)
    if (!open) return
    await resnapshotSession(open.id, session.adminId)
  } catch (err) {
    console.error('[homepage-edit] resnapshotSession failed', err)
  }
}

// Opens the admin's own homepage draft, or starts one (another alongside with _new=1). Opening
// someone else's draft (_draft) is read-only unless it is unclaimed. Keeps the tab the admin was on.
export async function startHomepageDraft(formData: FormData) {
  const actor = await actionActor()
  let draftId = (formData.get('_draft') as string | null) || null
  if (!draftId && formData.get('_new') !== '1' && actor?.adminId)
    draftId = (await draftsOf(homepageDrafts, HOMEPAGE_ENTITY_ID)).find(d => d.authorId === actor.adminId)?.id ?? null
  if (draftId) await tryAcquireForAction('homepage', draftId)
  else {
    const title = ((formData.get('_title') as string | null) || '').trim().slice(0, 120) || null
    draftId = await createHomepageDraft(actor, title)
  }
  const host = await getHost()
  const q = new URLSearchParams()
  for (const key of ['audience', 'page', 'surface']) {
    const v = formData.get(key)
    if (typeof v === 'string' && /^[a-z_]{1,16}$/.test(v)) q.set(key, v)
  }
  q.set('draft', draftId)
  redirect(`${ap('/admin/settings/homepage', host)}?${q}`)
}
