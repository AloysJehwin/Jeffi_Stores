import { Star } from 'lucide-react'
import ProductImage from './ProductImage'
import ProductWarningBadges from '@/components/shared/ProductWarningBadges'

interface Props {
  product: any
}

export default function ProductMobileCardBody({ product }: Props) {
  const stock = product.has_variants
    ? Number(product.variant_inventory_total)
    : Number(product.inventory_quantity ?? 0)
  const listedStock = product.has_variants ? Number(product.variant_stock_total) : null
  const stockStatus: string = product.stock_status || 'In Stock'
  const isOut = stock === 0 || stockStatus === 'Out of Stock'
  const isLow = !isOut && (stockStatus === 'Low Stock' || (product.has_variants && stock > 0 && stock <= 3))

  return (
    <>
      <div className="flex items-start gap-3 mb-3">
        <div className="flex-shrink-0 h-12 w-12">
          <ProductImage
            thumbnailUrl={
              product.product_images?.find((img: any) => img.is_primary)?.thumbnail_url ||
              product.product_images?.[0]?.thumbnail_url
            }
            altText={product.name}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-foreground truncate">{product.name}</div>
          <div className="text-xs text-foreground-muted truncate">{product.sku}</div>
          <ProductWarningBadges
            fragile={product.fragile}
            hazardous={product.hazardous}
            flammable={product.flammable}
            size="xs"
          />
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <span
            className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
              product.is_active
                ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                : 'bg-surface-secondary text-foreground'
            }`}
          >
            {product.is_active ? 'Active' : 'Inactive'}
          </span>
          {product.is_featured && (
            <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 inline-flex items-center gap-1">
              <Star className="w-3 h-3 fill-current" /> Featured
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div>
          {product.has_variants ? (
            <div className="flex items-baseline gap-1.5">
              <span className="text-sm font-semibold text-primary-500">
                From Rs. {Number(product.variant_min_price || 0).toLocaleString('en-IN')}
              </span>
              {product.variant_min_mrp && Number(product.variant_min_mrp) > Number(product.variant_min_price || 0) && (
                <span className="text-xs text-foreground-muted line-through">
                  Rs. {Number(product.variant_min_mrp).toLocaleString('en-IN')}
                </span>
              )}
            </div>
          ) : (
            <div className="flex items-baseline gap-1.5">
              <span className="text-sm font-semibold text-primary-500">
                Rs. {Number(product.base_price || 0).toLocaleString('en-IN')}
              </span>
              {product.mrp && Number(product.mrp) > Number(product.base_price || 0) && (
                <span className="text-xs text-foreground-muted line-through">
                  Rs. {Number(product.mrp).toLocaleString('en-IN')}
                </span>
              )}
            </div>
          )}
          <div className="text-xs text-foreground-muted mt-0.5 truncate">
            {product.categories?.name || 'N/A'} / {product.brands?.name || 'N/A'}
          </div>
        </div>
        <div className="space-y-0.5 text-right">
          <div className="flex items-center justify-end gap-1.5">
            <span className="text-xs text-foreground-muted">Inv</span>
            <span
              className={`text-sm font-semibold ${isOut ? 'text-red-600 dark:text-red-400' : isLow ? 'text-orange-500 dark:text-orange-400' : 'text-foreground'}`}
            >
              {stock}
            </span>
          </div>
          {listedStock !== null && (
            <div className="flex items-center justify-end gap-1.5">
              <span className="text-xs text-foreground-muted">Listed</span>
              <span className="text-sm text-foreground">{listedStock}</span>
            </div>
          )}
          <span
            className={`inline-block px-1.5 py-0.5 text-[10px] font-semibold rounded-full ${
              isOut
                ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                : isLow
                  ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300'
                  : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
            }`}
          >
            {isOut ? 'Out' : isLow ? 'Low' : 'In Stock'}
          </span>
        </div>
      </div>
    </>
  )
}
