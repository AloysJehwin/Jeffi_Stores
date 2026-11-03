'use server'

import { redirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { actionActor, draftEditUrl, tryAcquireForAction } from '@/lib/admin/draft-locks'
import { startProductDraft } from '@/lib/catalog/product-draft-id'

// Opens a draft from the product page's drafts panel: _draft opens that one (read-only when
// another admin holds it), _new=1 starts another alongside, else the admin's own.
export async function openProductDraft(id: string, formData: FormData) {
  const back = (formData.get('_back') as string | null) || null
  const host = await getHost()
  let draftId = (formData.get('_draft') as string | null) || null
  let mine = true
  if (draftId) mine = await tryAcquireForAction('product', draftId)
  else
    draftId = (
      await startProductDraft(await actionActor(), id, {
        fresh: formData.get('_new') === '1',
        title: (formData.get('_title') as string | null) || null,
      })
    ).draftId
  const url = draftEditUrl(`/admin/products/${id}/edit`, back, mine)
  redirect(ap(`${url}${url.includes('?') ? '&' : '?'}draft=${draftId}`, host))
}
