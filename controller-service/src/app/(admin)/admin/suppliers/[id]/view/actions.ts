'use server'

import { redirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { query } from '@/lib/shared/db'

// Create (or reuse) an edit-draft for the supplier, then redirect to the edit page.
// Single entry to editing; /edit redirects back to /view when no draft exists.
// `_formData` is unused but required for form-action typing.
export async function startSupplierDraft(id: string, _formData: FormData) {
  void _formData
  await query(
    `INSERT INTO supplier_drafts (supplier_id, fields)
     SELECT s.id, to_jsonb(s) - 'id' - 'created_at' - 'updated_at'
     FROM suppliers s WHERE s.id = $1
     ON CONFLICT (supplier_id) DO NOTHING`,
    [id]
  )
  const host = await getHost()
  redirect(ap(`/admin/suppliers/${id}/edit`, host))
}
