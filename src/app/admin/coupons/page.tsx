import Link from 'next/link'
import { queryMany, queryCount } from '@/lib/db'
import AdminFilters from '@/components/admin/AdminFilters'
import Pagination from '@/components/admin/Pagination'
import DeleteCouponButton from '@/components/admin/DeleteCouponButton'
import CouponTableRow from '@/components/admin/CouponTableRow'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const PAGE_SIZE = 25

async function getFilteredCoupons(filters: { is_active?: string; search?: string; page?: number }) {
  const conditions: string[] = []
  const params: unknown[] = []
  let i = 1

  if (filters.is_active === 'true' || filters.is_active === 'false') {
    conditions.push(`is_active = $${i++}`)
    params.push(filters.is_active === 'true')
  }
  if (filters.search) {
    conditions.push(`(code ILIKE $${i} OR description ILIKE $${i})`)
    params.push(`%${filters.search}%`)
    i++
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = PAGE_SIZE
  const offset = ((filters.page || 1) - 1) * limit

  const [coupons, total] = await Promise.all([
    queryMany(`SELECT * FROM coupons ${where} ORDER BY created_at DESC LIMIT $${i} OFFSET $${i + 1}`, [...params, limit, offset]),
    queryCount(`SELECT COUNT(*) FROM coupons ${where}`, params),
  ])

  return { coupons, total }
}

export default async function CouponsPage({ searchParams }: { searchParams: { [key: string]: string | undefined } }) {
  const page = Math.max(1, parseInt(searchParams.page || '1', 10))

  const [{ coupons, total }, allStats] = await Promise.all([
    getFilteredCoupons({ is_active: searchParams.is_active, search: searchParams.search, page }),
    getFilteredCoupons({}),
  ])

  const totalCoupons = allStats.total
  const activeCoupons = (allStats.coupons as { is_active: boolean }[]).filter(c => c.is_active).length
  const expiredCoupons = (allStats.coupons as { valid_until: string | null; is_active: boolean }[]).filter(c => c.valid_until && new Date(c.valid_until) < new Date()).length

  const buildUrl = (p: number) => {
    const params = new URLSearchParams()
    if (searchParams.is_active) params.set('is_active', searchParams.is_active)
    if (searchParams.search) params.set('search', searchParams.search)
    if (p > 1) params.set('page', String(p))
    const qs = params.toString()
    return `/admin/coupons${qs ? `?${qs}` : ''}`
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Coupons</h1>
          <p className="text-foreground-secondary mt-1 text-sm">Manage discount coupons</p>
        </div>
        <Link href="/admin/coupons/add" className="bg-accent-500 hover:bg-accent-600 text-white px-5 py-2.5 rounded-lg font-semibold transition-colors text-center text-sm sm:text-base">
          Add New Coupon
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-4 sm:gap-6 mb-6">
        <div className="bg-surface-elevated p-4 sm:p-6 rounded-lg shadow-sm border border-border-default">
          <p className="text-foreground-secondary text-sm">Total</p>
          <p className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground mt-2">{totalCoupons}</p>
        </div>
        <div className="bg-surface-elevated p-4 sm:p-6 rounded-lg shadow-sm border border-border-default">
          <p className="text-foreground-secondary text-sm">Active</p>
          <p className="text-2xl sm:text-3xl font-bold text-green-600 mt-2">{activeCoupons}</p>
        </div>
        <div className="bg-surface-elevated p-4 sm:p-6 rounded-lg shadow-sm border border-border-default">
          <p className="text-foreground-secondary text-sm">Expired</p>
          <p className="text-2xl sm:text-3xl font-bold text-red-500 mt-2">{expiredCoupons}</p>
        </div>
      </div>

      <AdminFilters
        filters={[{ name: 'is_active', label: 'Status', options: [{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }] }]}
        searchPlaceholder="Search by code or description..."
        />

      <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default overflow-hidden mt-4">
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-secondary">
              <tr>
                {['Code', 'Type', 'Value', 'Min Purchase', 'Usage', 'Valid Until', 'Status', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-foreground-secondary uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              {(coupons as CouponRow[]).map(c => (
                <CouponTableRow key={c.id} coupon={c} />
              ))}
              {coupons.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-foreground-muted">No coupons found</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-border-default">
          {(coupons as CouponRow[]).map(c => (
            <div key={c.id} className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-mono font-bold text-accent-500">{c.code}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                  {c.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
              <p className="text-sm text-foreground-secondary">{c.description || '—'}</p>
              <div className="text-xs text-foreground-muted">
                {c.discount_type === 'percentage' ? `${c.discount_value}% off` : `₹${c.discount_value} off`}
                {c.valid_until && ` · Expires ${new Date(c.valid_until).toLocaleDateString('en-IN')}`}
              </div>
              <div className="flex gap-3 pt-1">
                <Link href={`/admin/coupons/edit/${c.id}`} className="text-sm text-accent-500 hover:underline">Edit</Link>
                <DeleteCouponButton id={c.id} code={c.code} />
              </div>
            </div>
          ))}
          {coupons.length === 0 && <p className="p-6 text-center text-foreground-muted text-sm">No coupons found</p>}
        </div>
      </div>

      <Pagination page={page} total={total} pageSize={PAGE_SIZE} buildUrl={buildUrl} />
    </div>
  )
}

interface CouponRow {
  id: string
  code: string
  description: string | null
  discount_type: string
  discount_value: number
  min_purchase_amount: number | null
  usage_limit: number | null
  times_used: number
  valid_until: string | null
  is_active: boolean
}
