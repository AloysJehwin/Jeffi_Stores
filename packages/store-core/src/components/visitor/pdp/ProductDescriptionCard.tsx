import ProductPitchLine from '@/components/storefront-ai/ProductPitchLine'

/** The product description card, with the AI pitch line; renders nothing without a description. */
export default function ProductDescriptionCard({ product }: { product: Record<string, any> }) {
  if (!product.description) return null
  return (
    <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-6 sm:p-8 mb-8">
      <h2 className="text-2xl font-bold text-foreground mb-4">Product Description</h2>
      <p className="text-foreground-secondary leading-relaxed whitespace-pre-line">{product.description}</p>
      <ProductPitchLine
        productName={product.name}
        brand={product.brands?.name || null}
        category={product.categories?.name || null}
      />
    </div>
  )
}
