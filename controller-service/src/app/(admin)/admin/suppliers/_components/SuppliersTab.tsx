'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import AdminTypeahead from '@/components/admin/AdminTypeahead'
import AdminSelect from '@/components/admin/AdminSelect'
import SortableHeader, { sortOptions, type SortDir } from '@/components/admin/SortableHeader'
import { ap } from '@/lib/shared/admin-path'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import RowActions from '@/components/admin/RowActions'
import SuppliersMobileList from './SuppliersMobileList'
import { labelCls, PAGE_SIZE, ClientPagination, type Supplier } from '@/components/admin/purchasing/shared'

export default function SuppliersTab() {
  const canWriteSuppliers = useCanWrite('inventory')
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [sortCol, setSortCol] = useState<string | undefined>(undefined)
  const [sortDir, setSortDir] = useState<SortDir | undefined>(undefined)

  const SUPPLIER_SORT_KEYS: Record<string, string> = {
    name: 'name',
    gstin: 'gstin',
    contact: 'contact_name',
    phone: 'phone',
    terms: 'payment_terms',
    pos: 'po_count',
    status: 'is_active',
  }

  const sortedSuppliers =
    sortCol && SUPPLIER_SORT_KEYS[sortCol]
      ? [...suppliers].sort((a: any, b: any) => {
          const k = SUPPLIER_SORT_KEYS[sortCol]
          const cmp = String(a[k] ?? '').localeCompare(String(b[k] ?? ''), 'en', { numeric: true })
          return sortDir === 'asc' ? cmp : -cmp
        })
      : suppliers

  function handleSort(col: string, dir: SortDir) {
    setSortCol(col)
    setSortDir(dir)
  }

  const load = useCallback(
    async (pg = page) => {
      setLoading(true)
      const params = new URLSearchParams({ page: String(pg), limit: String(PAGE_SIZE) })
      if (search) params.set('search', search)
      if (showAll) params.set('all', 'true')
      const res = await fetch(`/api/admin/inventory/suppliers?${params}`)
      const json = await res.json()
      setSuppliers(json?.suppliers || [])
      setTotal(json?.total || 0)
      setLoading(false)
    },
    [search, showAll, page]
  )

  useEffect(() => {
    load(page)
  }, [load, page])

  function handleSearchChange(v: string) {
    setSearch(v)
    setPage(1)
  }

  async function toggleActive(s: Supplier) {
    await fetch(`/api/admin/inventory/suppliers/${s.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !s.is_active }),
    })
    load(page)
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[200px]">
          <label className={labelCls}>Search suppliers</label>
          <AdminTypeahead
            type="suppliers"
            value={search}
            onChange={handleSearchChange}
            placeholder="Name, GSTIN, contact..."
            inputClassName="w-full field-sm pr-9 bg-surface border border-border-secondary text-foreground focus:ring-2 focus:ring-accent-500 focus:border-transparent transition-colors hover:border-border-default placeholder:text-foreground-muted"
          />
        </div>
        <div className="flex flex-col">
          <AdminSelect
            label="Status"
            value={showAll ? 'all' : 'active'}
            onChange={v => {
              setShowAll(v === 'all')
              setPage(1)
            }}
            options={[
              { value: 'active', label: 'Active only' },
              { value: 'all', label: 'Show inactive' },
            ]}
            sm
          />
        </div>
      </div>

      {loading ? (
        <div className="bg-surface-elevated rounded-xl border border-border-default p-4 space-y-3">
          <div className="h-5 w-32 bg-surface-secondary rounded animate-pulse" />
          <div className="h-12 w-full bg-surface-secondary rounded animate-pulse" />
          <div className="h-12 w-full bg-surface-secondary rounded animate-pulse" />
          <div className="h-12 w-full bg-surface-secondary rounded animate-pulse" />
        </div>
      ) : (
        <>
          <div className="md:hidden space-y-3">
            {sortedSuppliers.length === 0 ? (
              <div className="bg-surface-elevated rounded-xl border border-border-default p-8 text-center text-sm text-foreground-secondary">
                {search ? `No suppliers matching "${search}"` : 'No suppliers yet'}
              </div>
            ) : (
              <SuppliersMobileList
                suppliers={sortedSuppliers}
                canWrite={canWriteSuppliers}
                onToggleActive={toggleActive}
              />
            )}
            <ClientPagination
              page={page}
              total={total}
              pageSize={PAGE_SIZE}
              onChange={p => {
                setPage(p)
                setLoading(true)
              }}
            />
          </div>
          <div className="hidden md:block bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-secondary border-b border-border-default">
                  <tr>
                    <SortableHeader
                      label="Name"
                      column="name"
                      options={sortOptions('text')}
                      currentSort={sortCol}
                      currentDir={sortDir}
                      onSort={handleSort}
                    />
                    <SortableHeader
                      label="GSTIN"
                      column="gstin"
                      options={sortOptions('text')}
                      currentSort={sortCol}
                      currentDir={sortDir}
                      onSort={handleSort}
                    />
                    <SortableHeader
                      label="Contact"
                      column="contact"
                      options={sortOptions('text')}
                      currentSort={sortCol}
                      currentDir={sortDir}
                      onSort={handleSort}
                      className="hidden sm:table-cell"
                    />
                    <SortableHeader
                      label="Phone"
                      column="phone"
                      options={sortOptions('text')}
                      currentSort={sortCol}
                      currentDir={sortDir}
                      onSort={handleSort}
                      className="hidden md:table-cell"
                    />
                    <SortableHeader
                      label="Terms"
                      column="terms"
                      options={sortOptions('number')}
                      currentSort={sortCol}
                      currentDir={sortDir}
                      onSort={handleSort}
                      className="hidden lg:table-cell"
                      align="right"
                    />
                    <SortableHeader
                      label="POs"
                      column="pos"
                      options={sortOptions('number')}
                      currentSort={sortCol}
                      currentDir={sortDir}
                      onSort={handleSort}
                      align="right"
                    />
                    <SortableHeader
                      label="Status"
                      column="status"
                      options={sortOptions('text')}
                      currentSort={sortCol}
                      currentDir={sortDir}
                      onSort={handleSort}
                    />
                    <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary uppercase tracking-wide">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-default">
                  {suppliers.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-foreground-secondary text-sm">
                        {search ? `No suppliers matching "${search}"` : 'No suppliers yet'}
                      </td>
                    </tr>
                  )}
                  {sortedSuppliers.map(s => (
                    <tr key={s.id} className="hover:bg-surface-secondary/50 transition-colors">
                      <td className="px-4 py-3 font-medium text-foreground">
                        <Link
                          href={ap(`/admin/suppliers/${s.id}/view`)}
                          className="hover:text-accent-500 hover:underline"
                        >
                          {s.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-foreground-secondary">{s.gstin || '—'}</td>
                      <td className="px-4 py-3 text-foreground-secondary hidden sm:table-cell">
                        {s.contact_name || '—'}
                      </td>
                      <td className="px-4 py-3 text-foreground-secondary hidden md:table-cell">
                        {s.phone ? `+91 ${s.phone}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-foreground-secondary hidden lg:table-cell">
                        {s.payment_terms}d
                      </td>
                      <td className="px-4 py-3 text-right text-foreground-secondary">{s.po_count}</td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${s.is_active ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-700/40 dark:text-gray-400'}`}
                        >
                          {s.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="hidden md:block">
                          <RowActions
                            size="sm"
                            actions={[
                              {
                                key: 'edit',
                                kind: 'edit',
                                label: 'Edit supplier',
                                href: ap(`/admin/suppliers/${s.id}/edit`),
                                scope: 'inventory',
                              },
                              {
                                key: 'toggle',
                                kind: 'toggle',
                                label: s.is_active ? 'Deactivate supplier' : 'Activate supplier',
                                onSelect: () => toggleActive(s),
                                scope: 'inventory',
                              },
                            ]}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 pb-4">
              <ClientPagination
                page={page}
                total={total}
                pageSize={PAGE_SIZE}
                onChange={p => {
                  setPage(p)
                  setLoading(true)
                }}
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
