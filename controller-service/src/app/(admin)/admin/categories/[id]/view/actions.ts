'use server'

import { redirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { query } from '@/lib/shared/db'
import { draftEditUrl, tryAcquireForAction } from '@/lib/admin/draft-locks'

// Create (or reuse) an edit-draft for the category, then redirect to the edit page.
// Single entry to editing; the edit page itself redirects back here when no draft exists.
export async function startCategoryDraft(id: string, formData: FormData) {
  const back = (formData.get('_back') as string | null) || null
  // Someone else's draft opens read-only.
  const mine = await tryAcquireForAction('category', id)
  if (mine)
    await query(
      `INSERT INTO category_drafts (category_id, fields)
       SELECT c.id, to_jsonb(c) - 'id' - 'created_at' - 'updated_at' - 'search_vector'
       FROM categories c WHERE c.id = $1
       ON CONFLICT (category_id) DO NOTHING`,
      [id]
    )
  const host = await getHost()
  redirect(ap(draftEditUrl(`/admin/categories/${id}/edit`, back, mine), host))
}
