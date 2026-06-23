import Link from 'next/link'
import { headers } from 'next/headers'
import { ap } from '@/lib/admin-path'
import { queryMany, queryCount } from '@/lib/db'
import AdminFilters from '@/components/admin/AdminFilters'
import Pagination from '@/components/admin/Pagination'
import DeleteCouponButton from '@/components/admin/DeleteCouponButton'
import CouponTableRow from '@/components/admin/CouponTableRow'
import SortableHeader from '@/components/admin/SortableHeader'
import { sortOptions } from '@/components/admin/sortOptions'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const PAGE_SIZE = 25

const COUPON_SORT_COLS: Record<string, string> = {
  code: 'code',
  type: 'discount_type',
  value: 'discount_value',
  min_purchase: 'min_purchase_amount',
  usage: 'times_used',
  valid_until: 'valid_until',
  status: 'is_active',
}

async function getFilteredCoupons(filters: { is_active?: string; search?: string; campaign?: string; page?: number; sort?: string; dir?: string }) {
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
  if (filters.campaign === '__manual__') {
    conditions.push(`(auto_generated = false OR auto_generated IS NULL)`)
  } else if (filters.campaign) {
    conditions.push(`generated_for_campaign = $${i++}`)
    params.push(filters.campaign)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = PAGE_SIZE
  const offset = ((filters.page || 1) - 1) * limit

  const safeCol = (filters.sort && COUPON_SORT_COLS[filters.sort]) ? COUPON_SORT_COLS[filters.sort] : 'created_at'
  const safeDir = filters.dir === 'asc' ? 'ASC' : 'DESC'
  const orderBy = `ORDER BY ${safeCol} ${safeDir}`

  const [coupons, total] = await Promise.all([
    queryMany(`SELECT * FROM coupons ${where} ${orderBy} LIMIT $${i} OFFSET $${i + 1}`, [...params, limit, offset]),
    queryCount(`SELECT COUNT(*) FROM coupons ${where}`, params),
  ])

  return { coupons, total }
}

export default async function CouponsPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | undefined }> }) {
  const resolvedSearchParams = await searchParams
  const host = (await headers()).get('host') ?? ''
  const page = Math.max(1, parseInt(resolvedSearchParams.page || '1', 10))
  const sort = resolvedSearchParams.sort
  const dir = resolvedSearchParams.dir as 'asc' | 'desc' | undefined
  const campaign = resolvedSearchParams.campaign

  const [{ coupons, total }, allStats] = await Promise.all([
    getFilteredCoupons({ is_active: resolvedSearchParams.is_active, search: resolvedSearchParams.search, campaign, page, sort, dir }),
    getFilteredCoupons({}),
  ])

  const totalCoupons = allStats.total
  const activeCoupons = (allStats.coupons as { is_active: boolean }[]).filter(c => c.is_active).length
  const expiredCoupons = (allStats.coupons as { valid_until: string | null; is_active: boolean }[]).filter(c => c.valid_until && new Date(c.valid_until) < new Date()).length
  const campaignCoupons = (allStats.coupons as { auto_generated: boolean }[]).filter(c => c.auto_generated).length

  const buildUrl = (p: number) => {
    const params = new URLSearchParams()
    if (resolvedSearchParams.is_active) params.set('is_active', resolvedSearchParams.is_active)
    if (resolvedSearchParams.search) params.set('search', resolvedSearchParams.search)
    if (campaign) params.set('campaign', campaign)
    if (sort) params.set('sort', sort)
    if (dir) params.set('dir', dir)
    if (p > 1) params.set('page', String(p))
    const qs = params.toString()
    return ap(`/admin/coupons${qs ? `?${qs}` : ''}`, host)
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Coupons</h1>
          <p className="text-foreground-secondary mt-1 text-sm">Manage discount coupons</p>
        </div>
        <Link href={ap('/admin/coupons/add', host)} className="bg-accent-500 hover:bg-accent-600 text-white px-5 py-2.5 rounded-lg font-semibold transition-colors text-center text-sm sm:text-base">
          Add New Coupon
        </Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6 mb-6">
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
        <div className="bg-surface-elevated p-4 sm:p-6 rounded-lg shadow-sm border border-border-default">
          <p className="text-foreground-secondary text-sm">From Campaigns</p>
          <p className="text-2xl sm:text-3xl font-bold text-purple-600 mt-2">{campaignCoupons}</p>
        </div>
      </div>

      <AdminFilters
        filters={[
          { name: 'is_active', label: 'Status', options: [{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }] },
          { name: 'campaign', label: 'Source', options: [{ value: '__manual__', label: 'Manual' }, { value: 'winback_90', label: 'Winback 90d' }, { value: 'winback_180', label: 'Winback 180d' }] },
        ]}
        searchPlaceholder="Search by code or description..."
        suggestType="coupons"
        />

      <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default overflow-hidden mt-4">
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-secondary">
              <tr>
                <SortableHeader label="Code" column="code" options={sortOptions('text')} currentSort={sort} currentDir={dir} />
                <SortableHeader label="Type" column="type" options={sortOptions('text')} currentSort={sort} currentDir={dir} />
                <SortableHeader label="Value" column="value" options={sortOptions('number')} currentSort={sort} currentDir={dir} />
                <SortableHeader label="Min Purchase" column="min_purchase" options={sortOptions('number')} currentSort={sort} currentDir={dir} />
                <SortableHeader label="Usage" column="usage" options={sortOptions('number')} currentSort={sort} currentDir={dir} />
                <SortableHeader label="Valid Until" column="valid_until" options={sortOptions('date')} currentSort={sort} currentDir={dir} />
                <SortableHeader label="Status" column="status" options={sortOptions('text')} currentSort={sort} currentDir={dir} />
                <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-secondary uppercase tracking-wider">Actions</th>
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
                <div className="flex flex-col gap-0.5">
                  <span className="font-mono font-bold text-accent-500">{c.code}</span>
                  {c.generated_for_campaign && (
                    <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 w-fit">
                      {c.generated_for_campaign}
                    </span>
                  )}
                </div>
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
                <Link href={ap(`/admin/coupons/edit/${c.id}`, host)} className="text-sm text-accent-500 hover:underline">Edit</Link>
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
  auto_generated: boolean
  generated_for_campaign: string | null
}
