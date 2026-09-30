import { Package, Star } from 'lucide-react'
import ImgWithSkeleton from '@/components/ui/ImgWithSkeleton'
import ProductWarningBadges from '@/components/shared/ProductWarningBadges'

interface Props {
  product: any
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-foreground-muted">{label}</p>
      <p className="text-sm text-foreground font-medium">{value}</p>
    </div>
  )
}

export default function ProductMobileDetailBody({ product: p }: Props) {
  const images: any[] = p.product_images || []
  const primaryImg = images.find((i: any) => i.is_primary) || images[0]
  const stock = p.has_variants ? Number(p.variant_inventory_total ?? 0) : Number(p.inventory_quantity ?? 0)

  return (
    <div className="p-5 space-y-4">
      <div className="aspect-square max-h-64 rounded-lg overflow-hidden bg-surface-secondary border border-border-default flex items-center justify-center">
        {primaryImg?.image_url || primaryImg?.thumbnail_url ? (
          <ImgWithSkeleton
            src={primaryImg.image_url || primaryImg.thumbnail_url}
            alt={p.name}
            blurhash={primaryImg.blurhash}
            className="w-full h-full object-contain"
          />
        ) : (
          <Package className="w-12 h-12 text-foreground-muted" />
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <span
          className={`px-2 py-0.5 text-xs font-semibold rounded-full ${p.is_active ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300' : 'bg-surface-secondary text-foreground-muted'}`}
        >
          {p.is_active ? 'Active' : 'Inactive'}
        </span>
        {p.is_featured && (
          <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 inline-flex items-center gap-1">
            <Star className="w-3 h-3 fill-current" /> Featured
          </span>
        )}
        <ProductWarningBadges fragile={p.fragile} hazardous={p.hazardous} flammable={p.flammable} size="xs" />
      </div>

      <div>
        <p className="text-xs text-foreground-muted uppercase tracking-wide mb-1">Price</p>
        {p.has_variants ? (
          <p className="text-xl font-bold text-primary-500">
            From Rs. {Number(p.variant_min_price || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </p>
        ) : (
          <div className="flex items-baseline gap-3">
            <p className="text-xl font-bold text-primary-500">
              Rs. {Number(p.base_price || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </p>
            {p.mrp && Number(p.mrp) > Number(p.base_price) && (
              <p className="text-sm text-foreground-muted line-through">
                Rs. {Number(p.mrp).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border-default pt-4">
        <Field label="Category" value={p.categories?.name || '—'} />
        <Field label="Brand" value={p.brands?.name || '—'} />
        <Field
          label="Inventory Stock"
          value={
            <>
              {stock}
              {p.has_variants && <span className="ml-1 text-xs text-foreground-muted">(across variants)</span>}
            </>
          }
        />
        <Field label="Online Status" value={p.stock_status || '—'} />
        <Field label="SKU" value={p.sku || '—'} />
        <Field label="HSN Code" value={p.hsn_code || '—'} />
      </div>

      {p.description && (
        <div className="border-t border-border-default pt-4">
          <p className="text-xs text-foreground-muted uppercase tracking-wide mb-1">Description</p>
          <p className="text-sm text-foreground leading-relaxed line-clamp-6">{p.description}</p>
        </div>
      )}
    </div>
  )
}
