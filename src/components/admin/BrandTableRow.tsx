'use client'

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
  return (
    <tr className="hover:bg-surface-secondary">
      <td className="px-6 py-4 whitespace-nowrap">
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
          <a href={brand.website} target="_blank" rel="noopener noreferrer" className="text-sm text-accent-500 hover:underline">
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
      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
        <Link href={`/admin/brands/edit/${brand.id}`} className="text-accent-500 hover:text-accent-600 mr-4">
          Edit
        </Link>
        <DeleteBrandButton brandId={brand.id} brandName={brand.name} />
      </td>
    </tr>
  )
}
