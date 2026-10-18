'use server'

import { redirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { query } from '@/lib/shared/db'

// Create (or reuse) an edit-draft for the brand, then redirect to the edit page.
// This is the single entry to editing; the edit page itself redirects back here
// (or to the brands list) when no draft exists.
export async function startBrandDraft(id: string, formData: FormData) {
  const back = (formData.get('_back') as string | null) || null
  await query(
    `INSERT INTO brand_drafts (brand_id, fields)
     SELECT b.id, to_jsonb(b) - 'id' - 'created_at' - 'updated_at'
     FROM brands b WHERE b.id = $1
     ON CONFLICT (brand_id) DO NOTHING`,
    [id]
  )
  const host = await getHost()
  const qs = back ? `?back=${encodeURIComponent(back)}` : ''
  redirect(ap(`/admin/brands/${id}/edit${qs}`, host))
}
