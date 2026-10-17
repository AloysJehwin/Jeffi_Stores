import { Suspense } from 'react'
import { listKey } from '@/lib/admin/list-key'
import { Plus } from 'lucide-react'
import { TabAction } from '@/components/admin/channels/ui'
import { headers } from 'next/headers'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { hasScope } from '@/lib/auth/scopes'
import { getFilteredCategories } from '@/lib/queries'
import { queryMany } from '@/lib/shared/db'
import CategoriesClient from './CategoriesClient'
import BrochureButton from '@/components/admin/BrochureButton'
import MisassignedProductsBanner from '@/components/admin/MisassignedProductsBanner'
import DraftRowActions from '@/components/admin/DraftRowActions'
import { DataToolbar, Kpi, KpiGrid, PageBody, PageHeader, TableSkeleton } from '@/components/admin/kit'
import GroupOverview from './_components/GroupOverview'
import { TabLinks, TabMemory } from '../products/_components/catalog-overview'
import { resolveListTab } from '@/lib/overviews/catalog'

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
    <div className="animate-fade-in space-y-4">
      <KpiGrid>
        <Kpi label="Total categories" value={totalCategories.toLocaleString('en-IN')} highlight />
        <Kpi label="Main categories" value={mainCategoriesCount.toLocaleString('en-IN')} />
        <Kpi label="Subcategories" value={subCategoriesCount.toLocaleString('en-IN')} />
      </KpiGrid>

      {pendingDraftsCount > 0 && (
        <details className="group rounded-xl border border-amber-500/40 bg-amber-500/5">
          <summary className="cursor-pointer list-none flex flex-wrap items-center justify-between gap-2 px-4 h-11">
            <span className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-400">
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
            <span className="text-xs text-foreground-muted">Not yet published to the live list</span>
          </summary>
          <div className="border-t border-amber-500/30 overflow-hidden">
            <div className="divide-y divide-amber-500/20">
              {/* Create-drafts: brand-new categories not yet on the live list. Publish activates them. */}
              {createDrafts.map(d =>
                canWrite ? (
                  <DraftRowActions
                    key={`new-${d.id}`}
                    entityId={d.id}
                    name={d.name}
                    subtitle="New category — not yet published"
                    updatedAt={d.created_at}
                    editHref={ap(`/admin/categories/${d.id}/edit`, host)}
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
                    <p className="text-sm font-medium text-foreground truncate">{d.name}</p>
                    <span className="text-xs text-foreground-muted">new</span>
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
                    editHref={ap(`/admin/categories/${d.category_id}/edit`, host)}
                    publishPath={`/api/admin/categories/${d.category_id}/publish`}
                    discardPath={`/api/admin/categories/${d.category_id}/draft`}
                    entityLabel="category"
                  />
                ) : (
                  <div key={d.category_id} className="px-4 py-2.5 flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground truncate">{d.name}</p>
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

export default async function CategoriesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams
  const tab = resolveListTab(sp)
  return (
    <PageBody>
      <PageHeader title="Categories" description="Manage product categories and subcategories" />

      <TabLinks
        base="/admin/categories"
        active={tab}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'list', label: 'Categories' },
        ]}
        actions={
          <>
            <BrochureButton mode="category" />
            <Suspense fallback={null}>
              <AddCategoryButton />
            </Suspense>
          </>
        }
      />
      <Suspense fallback={null}>
        <TabMemory storageKey="category" tab={tab} explicit={typeof sp.tab === 'string'} />
      </Suspense>

      {tab === 'overview' ? (
        <GroupOverview dim="category" />
      ) : (
        <>
          <Suspense fallback={<KpiRowSkeleton />}>
            <CategoriesStatsSection searchParams={searchParams} />
          </Suspense>

          <DataToolbar
            search={{ placeholder: 'Search by name...', param: 'search', suggestType: 'categories' }}
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
          />

          <CategoriesListSection searchParams={searchParams} />
        </>
      )}
    </PageBody>
  )
}

function KpiRowSkeleton() {
  return (
    <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6 animate-pulse">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-[84px] rounded-xl border border-border-default bg-surface-elevated" />
      ))}
    </div>
  )
}

async function AddCategoryButton() {
  const host = await getHost()
  const h = await headers()
  const role = h.get('x-user-role') || ''
  const scopes: string[] = JSON.parse(h.get('x-user-scopes') || '[]')
  if (!hasScope(role, scopes, 'categories:write')) return null
  return <TabAction href={ap('/admin/categories/add', host)} icon={<Plus className="w-4 h-4" />} label="Add New Category" />
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
  const key = listKey(resolvedSearchParams)
  return (
    <Suspense key={key} fallback={<TableSkeleton rows={8} cols={4} />}>
      <CategoriesListContent resolvedSearchParams={resolvedSearchParams} />
    </Suspense>
  )
}
