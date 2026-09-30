import { Suspense } from 'react'
import Link from 'next/link'
import { headers } from 'next/headers'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { hasScope } from '@/lib/auth/scopes'
import { getFilteredCategories } from '@/lib/queries'
import { queryMany } from '@/lib/shared/db'
import AdminFilters from '@/components/admin/AdminFilters'
import CategoriesClient from './CategoriesClient'
import BrochureButton from '@/components/admin/BrochureButton'
import MisassignedProductsBanner from '@/components/admin/MisassignedProductsBanner'
import DraftRowActions from '@/components/admin/DraftRowActions'
import AdminStatsSkeleton from '@/components/admin/AdminStatsSkeleton'
import AdminTableSkeleton from '@/components/admin/AdminTableSkeleton'

type SP = { [key: string]: string | undefined }

async function CategoriesStats({ resolvedSearchParams }: { resolvedSearchParams: SP }) {
  const [host, categories, misassignedRows, pendingDrafts, createDrafts] = await Promise.all([
    getHost(),
    getFilteredCategories({
      is_active: resolvedSearchParams.is_active,
    }),
    queryMany<{ id: string; name: string; category_id: string; category_name: string }>(
      `SELECT p.id, p.name, p.category_id, c.name AS category_name
       FROM products p
       JOIN categories c ON p.category_id = c.id
       WHERE p.is_active = true
         AND EXISTS (SELECT 1 FROM categories sub WHERE sub.parent_category_id = p.category_id)
       ORDER BY c.name, p.name`
    ),
    queryMany<{ category_id: string; name: string; updated_at: string }>(
      `SELECT cd.category_id, c.name, cd.updated_at
       FROM category_drafts cd
       JOIN categories c ON c.id = cd.category_id
       ORDER BY cd.updated_at DESC
       LIMIT 20`
    ),
    queryMany<{ id: string; name: string; created_at: string }>(
      `SELECT id, name, created_at FROM categories WHERE is_draft = true ORDER BY created_at DESC LIMIT 20`
    ),
  ])

  const h = await headers()
  const role = h.get('x-user-role') || ''
  const scopes: string[] = JSON.parse(h.get('x-user-scopes') || '[]')
  const canWrite = hasScope(role, scopes, 'categories:write')

  const allCategories = categories || []
  const mainCategoriesCount = allCategories.filter(c => !c.parent_category_id).length
  const totalCategories = allCategories.length
  const subCategoriesCount = totalCategories - mainCategoriesCount
  const pendingDraftsCount = pendingDrafts.length + createDrafts.length

  return (
    <div className="animate-fade-in">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 sm:gap-6 mb-6">
        <div className="bg-surface-elevated p-4 sm:p-6 rounded-lg shadow-sm border border-border-default">
          <p className="text-foreground-secondary text-sm">Total Categories</p>
          <p className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground mt-2">
            {totalCategories}
          </p>
        </div>
        <div className="bg-surface-elevated p-4 sm:p-6 rounded-lg shadow-sm border border-border-default">
          <p className="text-foreground-secondary text-sm">Main Categories</p>
          <p className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground mt-2">
            {mainCategoriesCount}
          </p>
        </div>
        <div className="bg-surface-elevated p-4 sm:p-6 rounded-lg shadow-sm border border-border-default">
          <p className="text-foreground-secondary text-sm">Subcategories</p>
          <p className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground mt-2">
            {subCategoriesCount}
          </p>
        </div>
      </div>

      {pendingDraftsCount > 0 && (
        <details className="mb-6 group">
          <summary className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-lg cursor-pointer list-none flex items-center justify-between px-4 py-2.5 group-open:rounded-b-none">
            <span className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
              <svg
                className="w-4 h-4 transition-transform group-open:rotate-90"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              Pending Drafts ({pendingDraftsCount})
            </span>
            <span className="text-xs text-amber-600 dark:text-amber-400">Not yet published to the live list</span>
          </summary>
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-t-0 border-amber-300 dark:border-amber-700 rounded-b-lg overflow-hidden">
            <div className="divide-y divide-amber-100 dark:divide-amber-800/30">
              {/* Create-drafts: brand-new categories not yet on the live list. Publish activates them. */}
              {createDrafts.map(d =>
                canWrite ? (
                  <DraftRowActions
                    key={`new-${d.id}`}
                    entityId={d.id}
                    name={d.name}
                    subtitle="New category — not yet published"
                    updatedAt={d.created_at}
                    editHref={ap(`/admin/categories/edit/${d.id}`, host)}
                    publishPath={`/api/admin/categories/${d.id}`}
                    publishMethod="PATCH"
                    publishBody={{ is_draft: false, is_active: true }}
                    publishConfirm={`Publish "${d.name}" to the live category list?`}
                    discardPath={`/api/categories/${d.id}`}
                    discardConfirm={`Delete the draft category "${d.name}"? This cannot be undone.`}
                    entityLabel="category"
                  />
                ) : (
                  <div key={`new-${d.id}`} className="px-4 py-2.5 flex items-center gap-2">
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-300 truncate">{d.name}</p>
                    <span className="text-xs text-amber-600 dark:text-amber-400">new</span>
                  </div>
                )
              )}
              {pendingDrafts.map(d =>
                canWrite ? (
                  <DraftRowActions
                    key={d.category_id}
                    entityId={d.category_id}
                    name={d.name}
                    updatedAt={d.updated_at}
                    editHref={ap(`/admin/categories/edit/${d.category_id}`, host)}
                    publishPath={`/api/admin/categories/${d.category_id}/publish`}
                    discardPath={`/api/admin/categories/${d.category_id}/draft`}
                    entityLabel="category"
                  />
                ) : (
                  <div key={d.category_id} className="px-4 py-2.5 flex items-center gap-2">
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-300 truncate">{d.name}</p>
                  </div>
                )
              )}
            </div>
          </div>
        </details>
      )}

      {misassignedRows.length > 0 && (
        <MisassignedProductsBanner products={misassignedRows} categories={allCategories} />
      )}
    </div>
  )
}

async function CategoriesListContent({ resolvedSearchParams }: { resolvedSearchParams: SP }) {
  const [categories, productCountRows] = await Promise.all([
    getFilteredCategories({
      is_active: resolvedSearchParams.is_active,
    }),
    queryMany<{ category_id: string; count: string }>(
      'SELECT category_id, COUNT(*) as count FROM products WHERE is_active = true GROUP BY category_id'
    ),
  ])

  const productCounts: Record<string, number> = {}
  productCountRows.forEach(r => {
    productCounts[r.category_id] = parseInt(r.count, 10)
  })

  const allCategories = categories || []

  const currentListUrl = (() => {
    const params = new URLSearchParams()
    if (resolvedSearchParams.is_active) params.set('is_active', resolvedSearchParams.is_active)
    if (resolvedSearchParams.search) params.set('search', resolvedSearchParams.search)
    if (resolvedSearchParams.type) params.set('type', resolvedSearchParams.type)
    const qs = params.toString()
    return `/admin/categories${qs ? `?${qs}` : ''}`
  })()

  return (
    <CategoriesClient
      initialCategories={allCategories}
      productCounts={productCounts}
      initialSearch={resolvedSearchParams.search || ''}
      initialType={resolvedSearchParams.type || ''}
      backUrl={currentListUrl}
    />
  )
}

export default function CategoriesPage({ searchParams }: { searchParams: Promise<SP> }) {
  return (
    <div className="p-4 sm:p-6">
      <Suspense fallback={<CategoriesHeaderFallback />}>
        <CategoriesHeader />
      </Suspense>

      <Suspense fallback={<AdminStatsSkeleton cards={3} banner={false} />}>
        <CategoriesStatsSection searchParams={searchParams} />
      </Suspense>

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
          {
            name: 'type',
            label: 'Type',
            options: [
              { value: 'main', label: 'Main Categories' },
              { value: 'sub', label: 'Subcategories' },
            ],
          },
        ]}
        searchPlaceholder="Search by name..."
        suggestType="categories"
        searchParam="search"
      />

      <CategoriesListSection searchParams={searchParams} />
    </div>
  )
}

async function CategoriesHeader() {
  const host = await getHost()
  const h = await headers()
  const role = h.get('x-user-role') || ''
  const scopes: string[] = JSON.parse(h.get('x-user-scopes') || '[]')
  const canWrite = hasScope(role, scopes, 'categories:write')
  return (
    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Categories</h1>
        <p className="text-foreground-secondary mt-1 text-sm">Manage product categories and subcategories</p>
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <BrochureButton mode="category" />
        {canWrite && (
          <Link
            href={ap('/admin/categories/add', host)}
            className="inline-flex items-center justify-center h-11 bg-accent-500 hover:bg-accent-600 text-white px-5 rounded-lg font-semibold transition-colors text-center text-sm sm:text-base"
          >
            Add New Category
          </Link>
        )}
      </div>
    </div>
  )
}

function CategoriesHeaderFallback() {
  return (
    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Categories</h1>
        <p className="text-foreground-secondary mt-1 text-sm">Manage product categories and subcategories</p>
      </div>
      <div className="inline-flex items-center justify-center h-11 bg-accent-500 text-white px-5 rounded-lg font-semibold text-center text-sm sm:text-base opacity-70">
        Add New Category
      </div>
    </div>
  )
}

// Resolves searchParams (no DB — near-instant) then runs the stats/aggregate
// query so the stat cards + misassigned banner stream in above the filters.
async function CategoriesStatsSection({ searchParams }: { searchParams: Promise<SP> }) {
  const resolvedSearchParams = await searchParams
  return <CategoriesStats resolvedSearchParams={resolvedSearchParams} />
}

// Resolves searchParams (no DB — near-instant) then keys the table Suspense
// on the query string so filter/pagination changes re-trigger the shimmer
// while the stats + filters above stay mounted.
async function CategoriesListSection({ searchParams }: { searchParams: Promise<SP> }) {
  const resolvedSearchParams = await searchParams
  const key = JSON.stringify(resolvedSearchParams)
  return (
    <Suspense key={key} fallback={<AdminTableSkeleton rows={8} cols={4} />}>
      <CategoriesListContent resolvedSearchParams={resolvedSearchParams} />
    </Suspense>
  )
}
