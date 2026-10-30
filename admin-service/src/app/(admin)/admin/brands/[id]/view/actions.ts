'use server'

import { redirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { actionActor, draftEditUrl, tryAcquireForAction } from '@/lib/admin/draft-locks'
import { createDraft, draftsOf } from '@/lib/admin/draft-branches'
import { brandDrafts } from '@/lib/catalog/brand-draft'

// Opens the admin's own draft of the brand, or starts one (another alongside with _new=1).
// Opening someone else's draft (_draft) is read-only unless it is unclaimed.
export async function startBrandDraft(id: string, formData: FormData) {
  const back = (formData.get('_back') as string | null) || null
  const host = await getHost()
  const open = (formData.get('_draft') as string | null) || null
  const actor = await actionActor()
  let draftId = open
  if (!draftId && formData.get('_new') !== '1' && actor?.adminId)
    draftId = (await draftsOf(brandDrafts, id)).find(d => d.authorId === actor.adminId)?.id ?? null
  let mine = true
  if (draftId) mine = await tryAcquireForAction('brand', draftId)
  else {
    const title = ((formData.get('_title') as string | null) || '').trim().slice(0, 120) || null
    draftId = await createDraft(brandDrafts, actor, id, { title })
  }
  const url = draftEditUrl(`/admin/brands/${id}/edit`, back, mine)
  redirect(ap(`${url}${url.includes('?') ? '&' : '?'}draft=${draftId}`, host))
}
