'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import AdminTypeahead from '@/components/admin/AdminTypeahead'
import AdminSelect from '@/components/admin/AdminSelect'
import { ap } from '@/lib/shared/admin-path'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { DataTable, type DataCol } from '@/components/admin/kit/data-table'
import { StatusBadge, ACTIVE_STATUS } from '@/components/admin/kit/status'
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

  const text = (v: unknown) => String(v ?? '').toLowerCase()
  const cols: DataCol<Supplier>[] = [
    {
      key: 'name',
      label: 'Name',
      sort: s => text(s.name),
      render: s => (
        <Link href={ap(`/admin/suppliers/${s.id}/view`)} className="font-medium text-foreground hover:text-accent-500 hover:underline">
          {s.name}
        </Link>
      ),
    },
    { key: 'gstin', label: 'GSTIN', sort: s => text(s.gstin), render: s => <span className="font-mono text-xs text-foreground-secondary">{s.gstin || '—'}</span> },
    { key: 'contact', label: 'Contact', hideBelow: 'sm', sort: s => text(s.contact_name), render: s => <span className="text-foreground-secondary">{s.contact_name || '—'}</span> },
    { key: 'phone', label: 'Phone', hideBelow: 'md', sort: s => text(s.phone), render: s => <span className="text-foreground-secondary">{s.phone ? `+91 ${s.phone}` : '—'}</span> },
    { key: 'terms', label: 'Terms', num: true, hideBelow: 'lg', sort: s => Number(s.payment_terms) || 0, render: s => <span className="text-foreground-secondary">{s.payment_terms}d</span> },
    { key: 'pos', label: 'POs', num: true, sort: s => Number(s.po_count) || 0, render: s => <span className="text-foreground-secondary">{s.po_count}</span> },
    { key: 'status', label: 'Status', sort: s => (s.is_active ? 1 : 0), render: s => <StatusBadge status={String(s.is_active)} map={ACTIVE_STATUS} /> },
  ]

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

      {/* The API pages at PAGE_SIZE; the table sorts only the current page, as before. */}
      <DataTable<Supplier>
        rows={suppliers}
        cols={cols}
        rowKey={s => s.id}
        mode="client"
        pageSize={Math.max(PAGE_SIZE, suppliers.length)}
        loading={loading}
        empty={search ? `No suppliers matching "${search}"` : 'No suppliers yet'}
        mobile={<SuppliersMobileList suppliers={suppliers} canWrite={canWriteSuppliers} onToggleActive={toggleActive} />}
        rowActions={s => [
          { key: 'edit', kind: 'edit', label: 'Edit supplier', href: ap(`/admin/suppliers/${s.id}/edit`), scope: 'inventory' },
          {
            key: 'toggle',
            kind: 'toggle',
            label: s.is_active ? 'Deactivate supplier' : 'Activate supplier',
            onSelect: () => toggleActive(s),
            scope: 'inventory',
          },
        ]}
      />
      {!loading && (
        <ClientPagination
          page={page}
          total={total}
          pageSize={PAGE_SIZE}
          onChange={p => {
            setPage(p)
            setLoading(true)
          }}
        />
      )}
    </div>
  )
}
