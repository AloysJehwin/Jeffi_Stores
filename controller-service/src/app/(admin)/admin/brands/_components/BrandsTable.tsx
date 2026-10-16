'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import HoverCard from '@/components/ui/HoverCard'
import { useToast } from '@/contexts/ToastContext'
import { RequireWrite } from '@/contexts/AdminScopesContext'
import { ap } from '@/lib/shared/admin-path'
import { DataTable, Dialog, Field, Fields, StatusBadge, ACTIVE_STATUS, badgeCls, type DataCol } from '@/components/admin/kit'
import BrandsMobileList from './BrandsMobileList'

interface Brand {
  id: string
  name: string
  slug: string
  description: string | null
  website: string | null
  is_active: boolean
  return_allowed: boolean
  return_window_days: number
  replacement_allowed: boolean
  replacement_window_days: number
}

const site = (url: string) => url.replace(/^https?:\/\//, '')

/** Active/Inactive chip; a toggle for admins with brands:write (optimistic, reverts on failure). */
function StatusCell({ brand }: { brand: Brand }) {
  const [isActive, setIsActive] = useState(brand.is_active)
  const [toggling, setToggling] = useState(false)

  async function toggleStatus(e: React.MouseEvent) {
    e.stopPropagation()
    if (toggling) return
    setToggling(true)
    const next = !isActive
    setIsActive(next)
    try {
      const res = await fetch(`/api/admin/brands/${brand.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: brand.name,
          slug: brand.slug,
          description: brand.description,
          website: brand.website,
          logo_url: null,
          is_active: next,
          return_allowed: brand.return_allowed,
          return_window_days: brand.return_window_days,
          replacement_allowed: brand.replacement_allowed,
          replacement_window_days: brand.replacement_window_days,
        }),
      })
      if (!res.ok) setIsActive(!next)
    } catch {
      setIsActive(!next)
    } finally {
      setToggling(false)
    }
  }

  return (
    <RequireWrite scope="brands:write" fallback={<StatusBadge status={String(isActive)} map={ACTIVE_STATUS} />}>
      <button
        type="button"
        onClick={toggleStatus}
        disabled={toggling}
        title={isActive ? 'Click to deactivate' : 'Click to activate'}
        className={`${badgeCls(isActive ? 'green' : 'muted')} transition-opacity ${toggling ? 'opacity-50' : 'hover:opacity-75'}`}
      >
        {isActive ? 'Active' : 'Inactive'}
      </button>
    </RequireWrite>
  )
}

export default function BrandsTable({
  brands,
  total,
  page,
  pageSize,
  isActive,
  search,
  backUrl,
}: {
  brands: Brand[]
  total: number
  page: number
  pageSize: number
  isActive?: string
  search?: string
  backUrl: string
}) {
  const router = useRouter()
  const { showToast } = useToast()
  const [open, setOpen] = useState<Brand | null>(null)
  const viewHref = (b: Brand) => ap(`/admin/brands/${b.id}?back=${encodeURIComponent(backUrl)}`)

  // Same page links as before: only the status filter, search and page are carried.
  const pageHref = (p: number) => {
    const params = new URLSearchParams()
    if (isActive) params.set('is_active', isActive)
    if (search) params.set('search', search)
    if (p > 1) params.set('page', String(p))
    const qs = params.toString()
    return ap(`/admin/brands${qs ? `?${qs}` : ''}`)
  }

  async function deleteBrand(brand: Brand) {
    const res = await fetch(`/api/brands/${brand.id}`, { method: 'DELETE' })
    if (!res.ok) {
      showToast((await res.json().catch(() => ({})))?.error || 'Failed to delete brand', 'error')
      return
    }
    showToast(`"${brand.name}" deleted successfully.`, 'success')
    router.refresh()
  }

  const cols: DataCol<Brand>[] = [
    {
      key: 'name',
      label: 'Brand',
      render: b => (
        <div className="min-w-0">
          <HoverCard
            trigger={
              <Link href={viewHref(b)} className="font-semibold text-foreground hover:text-accent-500 transition-colors" onClick={e => e.stopPropagation()}>
                {b.name}
              </Link>
            }
            align="left"
            side="bottom"
            width="260px"
          >
            <div className="p-3 space-y-2">
              <p className="font-semibold text-foreground text-sm">{b.name}</p>
              <div className="text-xs text-foreground-secondary space-y-1">
                <div className="flex justify-between gap-4">
                  <span>Slug</span>
                  <span className="font-mono text-foreground">{b.slug}</span>
                </div>
                {b.website && (
                  <div className="flex justify-between gap-4">
                    <span>Website</span>
                    <a href={b.website} target="_blank" rel="noopener noreferrer" className="text-accent-500 hover:underline truncate max-w-[140px]">
                      {site(b.website)}
                    </a>
                  </div>
                )}
                <div className="flex justify-between gap-4">
                  <span>Status</span>
                  <StatusBadge status={String(b.is_active)} map={ACTIVE_STATUS} />
                </div>
              </div>
              {b.description && <p className="text-xs text-foreground-muted border-t border-border-default pt-2 line-clamp-3">{b.description}</p>}
            </div>
          </HoverCard>
          {b.description && <div className="mt-0.5 max-w-xs truncate text-xs text-foreground-muted">{b.description}</div>}
        </div>
      ),
    },
    { key: 'slug', label: 'Slug', render: b => <span className="font-mono text-xs text-foreground-secondary">{b.slug}</span> },
    {
      key: 'website',
      label: 'Website',
      hideBelow: 'lg',
      render: b =>
        b.website ? (
          <a href={b.website} target="_blank" rel="noopener noreferrer" className="text-accent-500 hover:underline" onClick={e => e.stopPropagation()}>
            {site(b.website)}
          </a>
        ) : (
          <span className="text-foreground-muted">-</span>
        ),
    },
    { key: 'status', label: 'Status', render: b => <StatusCell brand={b} /> },
  ]

  return (
    <>
      <DataTable<Brand>
        mode="server"
        rows={brands}
        cols={cols}
        rowKey={b => b.id}
        total={total}
        page={page}
        pageSize={pageSize}
        pageHref={pageHref}
        onRowClick={setOpen}
        mobile={<BrandsMobileList brands={brands} backUrl={backUrl} />}
        empty={{ title: 'No brands found.', body: 'Add your first brand to get started.' }}
        rowActions={b => [
          {
            key: 'edit',
            kind: 'edit',
            label: 'Edit Brand',
            href: ap(`/admin/brands/${b.id}/edit?back=${encodeURIComponent(backUrl)}`),
            scope: 'brands:write',
          },
          {
            key: 'delete',
            kind: 'delete',
            label: 'Delete Brand',
            scope: 'brands:write',
            onSelect: () => deleteBrand(b),
            confirm: {
              title: 'Delete Brand',
              message: `Delete "${b.name}"? This action cannot be undone.`,
              confirmLabel: 'Delete',
              variant: 'danger',
            },
          },
        ]}
      />

      <Dialog
        open={!!open}
        onClose={() => setOpen(null)}
        title={open?.name}
        description={open && <span className="font-mono">{open.slug}</span>}
        zIndex="z-[300]"
        footer={
          open && (
            <Link href={viewHref(open)} onClick={() => setOpen(null)} className="control-md bg-accent-500 font-medium text-white hover:bg-accent-600">
              View Brand
            </Link>
          )
        }
      >
        {open && (
          <div className="space-y-5">
            <Fields>
              <Field label="Status" value={<StatusBadge status={String(open.is_active)} map={ACTIVE_STATUS} />} />
              {open.website && (
                <Field
                  label="Website"
                  value={
                    <a href={open.website} target="_blank" rel="noopener noreferrer" className="text-accent-500 hover:underline">
                      {site(open.website)}
                    </a>
                  }
                />
              )}
              {open.description && <Field span={2} label="Description" value={open.description} />}
            </Fields>
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">Return &amp; Replacement Policy</h3>
              <Fields>
                <Field label="Returns" value={<span className={badgeCls(open.return_allowed ? 'green' : 'red')}>{open.return_allowed ? `${open.return_window_days} days` : 'Not allowed'}</span>} />
                <Field label="Replacement" value={<span className={badgeCls(open.replacement_allowed ? 'green' : 'red')}>{open.replacement_allowed ? `${open.replacement_window_days} days` : 'Not allowed'}</span>} />
              </Fields>
            </div>
          </div>
        )}
      </Dialog>
    </>
  )
}
