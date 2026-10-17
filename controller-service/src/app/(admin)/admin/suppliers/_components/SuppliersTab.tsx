'use client'

import { useState } from 'react'
import Link from 'next/link'
import AdminTypeahead from '@/components/admin/AdminTypeahead'
import AdminSelect from '@/components/admin/AdminSelect'
import { ap } from '@/lib/shared/admin-path'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { DataTable, type DataCol } from '@/components/admin/kit/data-table'
import { fetchJson, useInfiniteList } from '@/components/admin/kit/infinite'
import { StatusBadge, ACTIVE_STATUS } from '@/components/admin/kit/status'
import SuppliersMobileList from './SuppliersMobileList'
import { labelCls, PAGE_SIZE, type Supplier } from '@/components/admin/purchasing/shared'

export default function SuppliersTab() {
  const canWriteSuppliers = useCanWrite('inventory')
  const [search, setSearch] = useState('')
  const [showAll, setShowAll] = useState(false)

  const list = useInfiniteList<Supplier>({
    key: `${search}|${showAll}`,
    pageSize: PAGE_SIZE,
    getKey: s => s.id,
    fetchPage: async (pg, signal) => {
      const params = new URLSearchParams({ page: String(pg), limit: String(PAGE_SIZE) })
      if (search) params.set('search', search)
      if (showAll) params.set('all', 'true')
      const json = await fetchJson(`/api/admin/inventory/suppliers?${params}`, signal)
      return { rows: json?.suppliers || [], total: json?.total || 0 }
    },
  })
  const suppliers = list.rows

  async function toggleActive(s: Supplier) {
    const res = await fetch(`/api/admin/inventory/suppliers/${s.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !s.is_active }),
    })
    if (!res.ok) return
    if (!showAll && s.is_active) list.setRows(rows => rows.filter(r => r.id !== s.id))
    else list.setRows(rows => rows.map(r => (r.id === s.id ? { ...r, is_active: !s.is_active } : r)))
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
            onChange={setSearch}
            placeholder="Name, GSTIN, contact..."
            inputClassName="w-full field-sm pr-9 bg-surface border border-border-secondary text-foreground focus:ring-2 focus:ring-accent-500 focus:border-transparent transition-colors hover:border-border-default placeholder:text-foreground-muted"
          />
        </div>
        <div className="flex flex-col">
          <AdminSelect
            label="Status"
            value={showAll ? 'all' : 'active'}
            onChange={v => setShowAll(v === 'all')}
            options={[
              { value: 'active', label: 'Active only' },
              { value: 'all', label: 'Show inactive' },
            ]}
            sm
          />
        </div>
      </div>

      {/* Pages of PAGE_SIZE load on scroll; column sort applies to the loaded rows. */}
      <DataTable<Supplier>
        rows={suppliers}
        cols={cols}
        rowKey={s => s.id}
        infinite={list}
        empty={search ? `No suppliers matching "${search}"` : 'No suppliers yet'}
        mobile={rows => <SuppliersMobileList suppliers={rows} canWrite={canWriteSuppliers} onToggleActive={toggleActive} />}
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
    </div>
  )
}
