import { redirect, notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { query, queryOne, queryMany } from '@/lib/db'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

interface ReviewForm {
  id: string; title: string; slug: string; description: string | null
  google_review_url: string; coupon_id: string | null; is_active: boolean
}
interface Coupon { id: string; code: string; description: string | null }

export default async function EditReviewFormPage({ params }: { params: { id: string } }) {
  const [form, coupons] = await Promise.all([
    queryOne<ReviewForm>('SELECT * FROM review_forms WHERE id = $1', [params.id]),
    queryMany<Coupon>('SELECT id, code, description FROM coupons WHERE is_active = true ORDER BY code'),
  ])
  if (!form) notFound()

  async function updateForm(formData: FormData) {
    'use server'
    const title = (formData.get('title') as string).trim()
    const slug = (formData.get('slug') as string).toLowerCase().trim().replace(/[^a-z0-9-]/g, '-')
    const description = (formData.get('description') as string).trim() || null
    const google_review_url = (formData.get('google_review_url') as string).trim()
    const coupon_id = formData.get('coupon_id') || null
    const is_active = formData.get('is_active') === 'on'

    try {
      await query(
        `UPDATE review_forms SET title=$1, slug=$2, description=$3, google_review_url=$4, coupon_id=$5, is_active=$6 WHERE id=$7`,
        [title, slug, description, google_review_url, coupon_id, is_active, params.id]
      )
    } catch (err) {
      if ((err as { digest?: string }).digest?.startsWith('NEXT_REDIRECT')) throw err
      throw new Error('Failed to update form')
    }
    revalidatePath('/admin/review-forms')
    redirect('/admin/review-forms')
  }

  return (
    <div className="p-4 sm:p-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin/review-forms" className="text-foreground-muted hover:text-foreground transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>
        </Link>
        <h1 className="text-2xl font-bold text-secondary-500 dark:text-foreground">Edit Review Form</h1>
      </div>

      <form action={updateForm} className="bg-surface-elevated rounded-lg border border-border-default p-6 space-y-5">
        <div>
          <label className="block text-sm font-medium text-foreground-secondary mb-1.5">Form Title *</label>
          <input name="title" required defaultValue={form.title} className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent" />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground-secondary mb-1.5">Slug *</label>
          <input name="slug" required defaultValue={form.slug} className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent font-mono" pattern="[a-z0-9-]+" />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground-secondary mb-1.5">Google Review URL *</label>
          <input name="google_review_url" type="url" required defaultValue={form.google_review_url} className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent" />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground-secondary mb-1.5">Reward Coupon</label>
          <select name="coupon_id" defaultValue={form.coupon_id || ''} className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent">
            <option value="">— No coupon —</option>
            {coupons.map(c => (
              <option key={c.id} value={c.id}>{c.code}{c.description ? ` — ${c.description}` : ''}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground-secondary mb-1.5">Description</label>
          <textarea name="description" rows={2} defaultValue={form.description || ''} className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent" />
        </div>
        <div className="flex items-center gap-2">
          <input type="checkbox" name="is_active" id="is_active" defaultChecked={form.is_active} className="w-4 h-4 text-accent-600 rounded border-border-secondary" />
          <label htmlFor="is_active" className="text-sm text-foreground-secondary">Active</label>
        </div>
        <div className="flex gap-3 pt-2">
          <Link href="/admin/review-forms" className="px-5 py-2 bg-surface-secondary hover:bg-border-default text-foreground-secondary rounded-lg font-medium transition-colors text-sm">Cancel</Link>
          <button type="submit" className="px-6 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg font-semibold transition-colors text-sm">Save Changes</button>
        </div>
      </form>
    </div>
  )
}
