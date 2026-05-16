import Link from 'next/link'
import { queryMany, queryCount } from '@/lib/db'
import AdminFilters from '@/components/admin/AdminFilters'
import Pagination from '@/components/admin/Pagination'
import DeleteReviewFormButton from '@/components/admin/DeleteReviewFormButton'
import CopyLinkButton from '@/components/admin/CopyLinkButton'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const PAGE_SIZE = 25
const FORMS_BASE_URL = 'https://forms.jeffistores.in'

async function getForms(filters: { search?: string; page?: number }) {
  const conditions: string[] = []
  const params: unknown[] = []
  let i = 1

  if (filters.search) {
    conditions.push(`(rf.title ILIKE $${i} OR rf.slug ILIKE $${i})`)
    params.push(`%${filters.search}%`)
    i++
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = PAGE_SIZE
  const offset = ((filters.page || 1) - 1) * limit

  const [forms, total] = await Promise.all([
    queryMany(
      `SELECT rf.*, c.code AS coupon_code FROM review_forms rf LEFT JOIN coupons c ON rf.coupon_id = c.id ${where} ORDER BY rf.created_at DESC LIMIT $${i} OFFSET $${i + 1}`,
      [...params, limit, offset]
    ),
    queryCount(`SELECT COUNT(*) FROM review_forms rf ${where}`, params),
  ])

  return { forms, total }
}

export default async function ReviewFormsPage({ searchParams }: { searchParams: { [key: string]: string | undefined } }) {
  const page = Math.max(1, parseInt(searchParams.page || '1', 10))
  const { forms, total } = await getForms({ search: searchParams.search, page })

  const buildUrl = (p: number) => {
    const params = new URLSearchParams()
    if (searchParams.search) params.set('search', searchParams.search)
    if (p > 1) params.set('page', String(p))
    const qs = params.toString()
    return `/admin/review-forms${qs ? `?${qs}` : ''}`
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Review Forms</h1>
          <p className="text-foreground-secondary mt-1 text-sm">Shareable forms that reward customers for Google reviews</p>
        </div>
        <Link href="/admin/review-forms/add" className="bg-accent-500 hover:bg-accent-600 text-white px-5 py-2.5 rounded-lg font-semibold transition-colors text-center text-sm sm:text-base">
          Create Form
        </Link>
      </div>

      <AdminFilters
        filters={[]}
        searchPlaceholder="Search by title or slug..."
        suggestType="review_forms"
      />

      <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default overflow-hidden mt-4">
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-secondary">
              <tr>
                {['Title', 'Shareable Link', 'Coupon', 'Submissions', 'Status', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-foreground-secondary uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              {(forms as FormRow[]).map(f => {
                const formUrl = `${FORMS_BASE_URL}/${f.slug}`
                return (
                  <tr key={f.id} className="hover:bg-surface-secondary/50 transition-colors">
                    <td className="px-4 py-3 font-medium text-foreground">{f.title}</td>
                    <td className="px-4 py-3 max-w-[260px]">
                      <div className="flex items-center gap-2">
                        <a
                          href={formUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent-500 hover:underline text-xs shrink-0"
                        >
                          Open ↗
                        </a>
                        <CopyLinkButton url={formUrl} />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-foreground-secondary">{f.coupon_code || <span className="text-foreground-muted">None</span>}</td>
                    <td className="px-4 py-3">
                      <Link href={`/admin/review-forms/${f.id}/submissions`} className="text-accent-500 hover:underline font-medium">
                        {f.submissions_count} view
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${f.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                        {f.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Link href={`/admin/review-forms/edit/${f.id}`} className="text-accent-500 hover:underline text-sm">Edit</Link>
                        <DeleteReviewFormButton id={f.id} title={f.title} />
                      </div>
                    </td>
                  </tr>
                )
              })}
              {forms.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-foreground-muted">No review forms yet. Create your first one!</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="md:hidden divide-y divide-border-default">
          {(forms as FormRow[]).map(f => {
            const formUrl = `${FORMS_BASE_URL}/${f.slug}`
            return (
              <div key={f.id} className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground">{f.title}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${f.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                    {f.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <CopyLinkButton url={formUrl} />
                <p className="text-xs text-foreground-muted">Coupon: {f.coupon_code || 'None'} · {f.submissions_count} submissions</p>
                <div className="flex gap-3 pt-1">
                  <a href={formUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-foreground-muted hover:underline">Open ↗</a>
                  <Link href={`/admin/review-forms/${f.id}/submissions`} className="text-xs text-accent-500 hover:underline">Submissions</Link>
                  <Link href={`/admin/review-forms/edit/${f.id}`} className="text-xs text-accent-500 hover:underline">Edit</Link>
                  <DeleteReviewFormButton id={f.id} title={f.title} />
                </div>
              </div>
            )
          })}
          {forms.length === 0 && <p className="p-6 text-center text-foreground-muted text-sm">No review forms yet.</p>}
        </div>
      </div>

      <Pagination page={page} total={total} pageSize={PAGE_SIZE} buildUrl={buildUrl} />
    </div>
  )
}

interface FormRow {
  id: string
  title: string
  slug: string
  coupon_code: string | null
  submissions_count: number
  is_active: boolean
}
