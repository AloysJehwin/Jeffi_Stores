import Link from 'next/link'
import { queryMany, queryCount } from '@/lib/db'
import DeleteBrandButton from '@/components/admin/DeleteBrandButton'
import AdminFilters from '@/components/admin/AdminFilters'
import Pagination from '@/components/admin/Pagination'
import BrandTableRow from '@/components/admin/BrandTableRow'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const PAGE_SIZE = 25

async function getFilteredBrands(filters: { is_active?: string; search?: string; page?: number; limit?: number }) {
  const conditions: string[] = []
  const params: any[] = []
  let i = 1

  if (filters.is_active === 'true' || filters.is_active === 'false') {
    conditions.push(`is_active = $${i++}`)
    params.push(filters.is_active === 'true')
  }
  if (filters.search) {
    conditions.push(`name ILIKE $${i}`)
    params.push(`%${filters.search}%`)
    i++
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = filters.limit || 25
  const offset = ((filters.page || 1) - 1) * limit

  const [brands, total] = await Promise.all([
    queryMany(`SELECT * FROM brands ${where} ORDER BY name ASC LIMIT $${i} OFFSET $${i + 1}`, [...params, limit, offset]),
    queryCount(`SELECT COUNT(*) FROM brands ${where}`, params),
  ])

  return { brands, total }
}

export default async function BrandsPage({ searchParams }: { searchParams: { [key: string]: string | undefined } }) {
  const page = Math.max(1, parseInt(searchParams.page || '1', 10))

  const [{ brands, total }, allStats] = await Promise.all([
    getFilteredBrands({ is_active: searchParams.is_active, search: searchParams.search, page, limit: PAGE_SIZE }),
    getFilteredBrands({}),
  ])

  const totalBrands = allStats.total
  const activeBrands = allStats.brands?.filter((b: any) => b.is_active).length || 0
  const inactiveBrands = totalBrands - activeBrands

  const buildUrl = (p: number) => {
    const params = new URLSearchParams()
    if (searchParams.is_active) params.set('is_active', searchParams.is_active)
    if (searchParams.search) params.set('search', searchParams.search)
    if (p > 1) params.set('page', String(p))
    const qs = params.toString()
    return `/admin/brands${qs ? `?${qs}` : ''}`
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Brands</h1>
          <p className="text-foreground-secondary mt-1 text-sm">Manage product brands</p>
        </div>
        <Link
          href="/admin/brands/add"
          className="bg-accent-500 hover:bg-accent-600 text-white px-5 py-2.5 rounded-lg font-semibold transition-colors text-center text-sm sm:text-base"
        >
          Add New Brand
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-4 sm:gap-6 mb-6">
        <div className="bg-surface-elevated p-4 sm:p-6 rounded-lg shadow-sm border border-border-default">
          <p className="text-foreground-secondary text-sm">Total Brands</p>
          <p className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground mt-2">{totalBrands}</p>
        </div>
        <div className="bg-surface-elevated p-4 sm:p-6 rounded-lg shadow-sm border border-border-default">
          <p className="text-foreground-secondary text-sm">Active</p>
          <p className="text-2xl sm:text-3xl font-bold text-green-600 mt-2">{activeBrands}</p>
        </div>
        <div className="bg-surface-elevated p-4 sm:p-6 rounded-lg shadow-sm border border-border-default">
          <p className="text-foreground-secondary text-sm">Inactive</p>
          <p className="text-2xl sm:text-3xl font-bold text-orange-600 mt-2">{inactiveBrands}</p>
        </div>
      </div>

      <AdminFilters
        filters={[
          {
            name: 'is_active',
            label: 'Status',
            options: [
              { value: 'true', label: 'Active' },
              { value: 'false', label: 'Inactive' },
            ],
          },
        ]}
        searchPlaceholder="Search by name..."
        searchParam="search"
      />

      <div className="md:hidden space-y-3">
        {brands && brands.length > 0 ? (
          brands.map((brand: any) => (
            <div key={brand.id} className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4">
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-foreground">{brand.name}</div>
                  {brand.description && (
                    <div className="text-xs text-foreground-muted mt-1 line-clamp-2">{brand.description}</div>
                  )}
                </div>
                <span className={`flex-shrink-0 ml-2 px-2 py-0.5 text-xs font-semibold rounded-full ${
                  brand.is_active
                    ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                    : 'bg-surface-secondary text-foreground'
                }`}>
                  {brand.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
              <div className="text-xs text-foreground-muted mb-3">{brand.slug}</div>
              {brand.website && (
                <div className="text-xs text-foreground-muted mb-3">
                  <a href={brand.website} target="_blank" rel="noopener noreferrer" className="text-accent-500 hover:underline">
                    {brand.website}
                  </a>
                </div>
              )}
              <div className="flex items-center justify-end gap-3 text-sm">
                <Link href={`/admin/brands/edit/${brand.id}`} className="text-accent-500 font-medium">
                  Edit
                </Link>
                <DeleteBrandButton brandId={brand.id} brandName={brand.name} />
              </div>
            </div>
          ))
        ) : (
          <div className="bg-surface-elevated rounded-lg border border-border-default p-8 text-center text-foreground-muted">
            No brands found. Add your first brand to get started.
          </div>
        )}
        <Pagination page={page} total={total} pageSize={PAGE_SIZE} buildUrl={buildUrl} />
      </div>

      <div className="hidden md:block bg-surface-elevated rounded-lg shadow-sm border border-border-default overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border-default">
            <thead className="bg-surface-secondary">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">Brand</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">Slug</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">Website</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-foreground-muted uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              {brands && brands.length > 0 ? (
                brands.map((brand: any) => (
                  <BrandTableRow key={brand.id} brand={brand} />
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-foreground-muted">
                    No brands found. Add your first brand to get started.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-3 border-t border-border-default">
          <Pagination page={page} total={total} pageSize={PAGE_SIZE} buildUrl={buildUrl} />
        </div>
      </div>
    </div>
  )
}
