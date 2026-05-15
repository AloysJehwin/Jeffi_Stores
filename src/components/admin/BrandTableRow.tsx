'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import HoverCard from '@/components/ui/HoverCard'
import DeleteBrandButton from '@/components/admin/DeleteBrandButton'

interface Brand {
  id: string
  name: string
  slug: string
  description: string | null
  website: string | null
  is_active: boolean
}

export default function BrandTableRow({ brand }: { brand: Brand }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      {open && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div
            className="relative bg-surface-elevated rounded-xl shadow-2xl border border-border-default w-full max-w-md max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between p-5 border-b border-border-default">
              <div>
                <h2 className="text-lg font-bold text-foreground">{brand.name}</h2>
                <p className="text-xs text-foreground-muted font-mono mt-0.5">{brand.slug}</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-lg hover:bg-surface-secondary text-foreground-muted hover:text-foreground transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-surface-secondary">
                <div>
                  <p className="text-xs text-foreground-muted">Status</p>
                  <p className={`text-sm font-semibold mt-0.5 ${brand.is_active ? 'text-green-600 dark:text-green-400' : 'text-foreground-muted'}`}>
                    {brand.is_active ? 'Active' : 'Inactive'}
                  </p>
                </div>
                {brand.website && (
                  <div>
                    <p className="text-xs text-foreground-muted">Website</p>
                    <a href={brand.website} target="_blank" rel="noopener noreferrer" className="text-sm text-accent-500 hover:underline mt-0.5 block truncate">
                      {brand.website.replace(/^https?:\/\//, '')}
                    </a>
                  </div>
                )}
              </div>
              {brand.description && (
                <div>
                  <p className="text-xs text-foreground-muted uppercase tracking-wide mb-1.5">Description</p>
                  <p className="text-sm text-foreground leading-relaxed">{brand.description}</p>
                </div>
              )}
              <div className="flex gap-3 pt-1 border-t border-border-default">
                <Link
                  href={`/admin/brands/edit/${brand.id}`}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent-500 hover:bg-accent-600 text-white transition-colors"
                  onClick={() => setOpen(false)}
                >
                  Edit Brand
                </Link>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
      <tr className="hover:bg-surface-secondary cursor-pointer" onClick={() => setOpen(true)}>
        <td className="px-6 py-4 whitespace-nowrap" onClick={e => e.stopPropagation()}>
          <HoverCard
            trigger={
              <span className="text-sm font-semibold text-foreground cursor-default underline decoration-dotted underline-offset-2 hover:text-accent-500 transition-colors">
                {brand.name}
              </span>
            }
            align="left"
            side="bottom"
            width="260px"
          >
            <div className="p-3 space-y-2">
              <p className="font-semibold text-foreground text-sm">{brand.name}</p>
              <div className="text-xs text-foreground-secondary space-y-1">
                <div className="flex justify-between gap-4">
                  <span>Slug</span>
                  <span className="font-mono text-foreground">{brand.slug}</span>
                </div>
                {brand.website && (
                  <div className="flex justify-between gap-4">
                    <span>Website</span>
                    <a href={brand.website} target="_blank" rel="noopener noreferrer" className="text-accent-500 hover:underline truncate max-w-[140px]">
                      {brand.website.replace(/^https?:\/\//, '')}
                    </a>
                  </div>
                )}
                <div className="flex justify-between gap-4">
                  <span>Status</span>
                  <span className={`font-medium ${brand.is_active ? 'text-green-600 dark:text-green-400' : 'text-foreground-muted'}`}>
                    {brand.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
              {brand.description && (
                <p className="text-xs text-foreground-muted border-t border-border-default pt-2 line-clamp-3">{brand.description}</p>
              )}
            </div>
          </HoverCard>
          {brand.description && (
            <div className="text-xs text-foreground-muted mt-1 max-w-xs truncate">{brand.description}</div>
          )}
        </td>
        <td className="px-6 py-4 whitespace-nowrap">
          <div className="text-sm text-foreground-secondary">{brand.slug}</div>
        </td>
        <td className="px-6 py-4 whitespace-nowrap">
          {brand.website ? (
            <a href={brand.website} target="_blank" rel="noopener noreferrer" className="text-sm text-accent-500 hover:underline" onClick={e => e.stopPropagation()}>
              {brand.website.replace(/^https?:\/\//, '')}
            </a>
          ) : (
            <span className="text-sm text-foreground-muted">—</span>
          )}
        </td>
        <td className="px-6 py-4 whitespace-nowrap">
          <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
            brand.is_active
              ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
              : 'bg-surface-secondary text-foreground'
          }`}>
            {brand.is_active ? 'Active' : 'Inactive'}
          </span>
        </td>
        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium" onClick={e => e.stopPropagation()}>
          <Link href={`/admin/brands/edit/${brand.id}`} className="text-accent-500 hover:text-accent-600 mr-4">
            Edit
          </Link>
          <DeleteBrandButton brandId={brand.id} brandName={brand.name} />
        </td>
      </tr>
    </>
  )
}
