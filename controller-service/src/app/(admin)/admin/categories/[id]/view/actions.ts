'use server'

import { redirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { query } from '@/lib/shared/db'

// Create (or reuse) an edit-draft for the category, then redirect to the edit page.
// Single entry to editing; the edit page itself redirects back here when no draft exists.
export async function startCategoryDraft(id: string, formData: FormData) {
  const back = (formData.get('_back') as string | null) || null
  await query(
    `INSERT INTO category_drafts (category_id, fields)
     SELECT c.id, to_jsonb(c) - 'id' - 'created_at' - 'updated_at' - 'search_vector'
     FROM categories c WHERE c.id = $1
     ON CONFLICT (category_id) DO NOTHING`,
    [id]
  )
  const host = await getHost()
  const qs = back ? `?back=${encodeURIComponent(back)}` : ''
  redirect(ap(`/admin/categories/${id}/edit${qs}`, host))
}
