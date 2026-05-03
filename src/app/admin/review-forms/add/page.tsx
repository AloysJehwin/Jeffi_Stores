import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { query, queryMany } from '@/lib/db'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

interface Coupon { id: string; code: string; description: string | null; is_active: boolean }

async function createReviewForm(formData: FormData) {
  'use server'
  const title = (formData.get('title') as string).trim()
  const slug = (formData.get('slug') as string).toLowerCase().trim().replace(/[^a-z0-9-]/g, '-')
  const description = (formData.get('description') as string).trim() || null
  const google_review_url = (formData.get('google_review_url') as string).trim()
  const coupon_id = formData.get('coupon_id') || null
  const is_active = formData.get('is_active') === 'on'

  try {
    await query(
      `INSERT INTO review_forms (title, slug, description, google_review_url, coupon_id, is_active) VALUES ($1,$2,$3,$4,$5,$6)`,
      [title, slug, description, google_review_url, coupon_id, is_active]
    )
  } catch (err) {
    if ((err as { digest?: string }).digest?.startsWith('NEXT_REDIRECT')) throw err
    throw new Error('Failed to create form — slug may already be taken')
  }
  revalidatePath('/admin/review-forms')
  redirect('/admin/review-forms')
}

export default async function AddReviewFormPage() {
  const coupons = await queryMany<Coupon>('SELECT id, code, description, is_active FROM coupons WHERE is_active = true ORDER BY code')

  return (
    <div className="p-4 sm:p-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin/review-forms" className="text-foreground-muted hover:text-foreground transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-secondary-500 dark:text-foreground">Create Review Form</h1>
          <p className="text-sm text-foreground-secondary mt-0.5">Build a shareable form to collect Google reviews</p>
        </div>
      </div>

      <form action={createReviewForm} className="bg-surface-elevated rounded-lg border border-border-default p-6 space-y-5">
        <div>
          <label className="block text-sm font-medium text-foreground-secondary mb-1.5">Form Title *</label>
          <input name="title" required className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent" placeholder="e.g. Leave Us a Google Review" />
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground-secondary mb-1.5">
            Slug * <span className="text-foreground-muted font-normal">— forms.jeffistores.in/<strong>this-slug</strong></span>
          </label>
          <input name="slug" required className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent font-mono" placeholder="e.g. google-review" pattern="[a-z0-9-]+" title="Lowercase letters, numbers, hyphens only" />
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground-secondary mb-1.5">Google Review URL *</label>
          <input name="google_review_url" type="url" required className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent" placeholder="https://g.page/r/..." />
          <p className="mt-1 text-xs text-foreground-muted">Paste your Google Maps review link — customers will be sent here first</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground-secondary mb-1.5">Reward Coupon</label>
          <select name="coupon_id" className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent">
            <option value="">— No coupon —</option>
            {coupons.map(c => (
              <option key={c.id} value={c.id}>{c.code}{c.description ? ` — ${c.description}` : ''}</option>
            ))}
          </select>
          {coupons.length === 0 && (
            <p className="mt-1 text-xs text-amber-600">No active coupons found. <Link href="/admin/coupons/add" className="underline">Create one first.</Link></p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground-secondary mb-1.5">Description</label>
          <textarea name="description" rows={2} className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent" placeholder="Optional — shown to customer on the form page" />
        </div>

        <div className="flex items-center gap-2">
          <input type="checkbox" name="is_active" id="is_active" defaultChecked className="w-4 h-4 text-accent-600 rounded border-border-secondary" />
          <label htmlFor="is_active" className="text-sm text-foreground-secondary">Active (form accepts submissions)</label>
        </div>

        <div className="flex gap-3 pt-2">
          <Link href="/admin/review-forms" className="px-5 py-2 bg-surface-secondary hover:bg-border-default text-foreground-secondary rounded-lg font-medium transition-colors text-sm">
            Cancel
          </Link>
          <button type="submit" className="px-6 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg font-semibold transition-colors text-sm">
            Create Form
          </button>
        </div>
      </form>
    </div>
  )
}
