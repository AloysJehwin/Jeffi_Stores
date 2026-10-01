'use server'

import { redirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { revalidatePath } from 'next/cache'
import { query } from '@/lib/shared/db'

export async function createBrand(formData: FormData) {
  const name = formData.get('name') as string
  const slug =
    (formData.get('slug') as string) ||
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  const description = (formData.get('description') as string) || null
  const website = (formData.get('website') as string) || null
  const logo_url = (formData.get('logo_url') as string) || null
  const return_allowed = formData.get('return_allowed') !== 'false'
  const return_window_days = Math.max(1, parseInt(formData.get('return_window_days') as string) || 7)
  const replacement_allowed = formData.get('replacement_allowed') !== 'false'
  const replacement_window_days = Math.max(1, parseInt(formData.get('replacement_window_days') as string) || 7)

  // Create-as-draft: is_draft = true (and is_active = false) so the brand lives ONLY in the
  // Drafts section, never the live list. "Publish" flips is_draft = false + is_active = true.
  try {
    await query<{ id: string }>(
      `INSERT INTO brands (name, slug, description, website, logo_url, is_active, is_draft, return_allowed, return_window_days, replacement_allowed, replacement_window_days)
       VALUES ($1, $2, $3, $4, $5, false, true, $6, $7, $8, $9) RETURNING id`,
      [
        name,
        slug,
        description,
        website,
        logo_url,
        return_allowed,
        return_window_days,
        replacement_allowed,
        replacement_window_days,
      ]
    )

    revalidatePath('/admin/brands')

    const host = await getHost()
    redirect(ap('/admin/brands', host))
  } catch (err: any) {
    if (err?.digest?.startsWith('NEXT_REDIRECT')) throw err
    throw new Error('Failed to create brand')
  }
}
