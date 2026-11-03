'use server'

import { redirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { createDraft, draftsOf } from '@/lib/admin/draft-branches'
import { offerDrafts } from '@/lib/admin/offer-drafts'
import { actionActor, draftEditUrl, tryAcquireForAction } from '@/lib/admin/draft-locks'

// Opens the admin's own draft of the offer, or starts one (another alongside with _new=1).
// Opening someone else's draft (_draft) is read-only unless it is unclaimed.
export async function startOfferDraft(id: string, formData: FormData) {
  const back = (formData.get('_back') as string | null) || null
  const open = (formData.get('_draft') as string | null) || null
  const actor = await actionActor()
  let draftId = open
  if (!draftId && formData.get('_new') !== '1' && actor?.adminId)
    draftId = (await draftsOf(offerDrafts, id)).find(d => d.authorId === actor.adminId)?.id ?? null
  let mine = true
  if (draftId) mine = await tryAcquireForAction('offer', draftId)
  else {
    const title = ((formData.get('_title') as string | null) || '').trim().slice(0, 120) || null
    draftId = await createDraft(offerDrafts, actor, id, { title })
  }
  const url = draftEditUrl(`/admin/offers/${id}/edit`, back, mine)
  redirect(ap(`${url}${url.includes('?') ? '&' : '?'}draft=${draftId}`, await getHost()))
}
