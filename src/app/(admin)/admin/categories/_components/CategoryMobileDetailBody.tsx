interface DetailCategory {
  slug: string
  display_order: number
  is_active: boolean
  sku_prefix?: string | null
  description: string | null
  return_allowed?: boolean | null
  return_window_days?: number | null
  replacement_allowed?: boolean | null
  replacement_window_days?: number | null
}

interface Props {
  category: DetailCategory
  parentName?: string | null
  subCount?: number
  productCount?: number
}

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-border-default last:border-0">
      <span className="text-xs font-medium text-foreground-muted flex-shrink-0">{label}</span>
      <span className="text-sm text-foreground text-right break-words min-w-0">{value}</span>
    </div>
  )
}

function policyText(allowed: boolean | null | undefined, days: number | null | undefined) {
  if (allowed == null) return null
  if (!allowed) return 'Not allowed'
  return days != null ? `${days} days` : 'Allowed'
}

export default function CategoryMobileDetailBody({ category, parentName, subCount, productCount }: Props) {
  return (
    <div className="px-5 py-4">
      <div className="mb-3">
        <span
          className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full ${
            category.is_active
              ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
              : 'bg-surface-secondary text-foreground'
          }`}
        >
          {category.is_active ? 'Active' : 'Inactive'}
        </span>
      </div>
      <Row label="Slug" value={category.slug} />
      <Row label="Parent" value={parentName || null} />
      <Row label="Order" value={String(category.display_order)} />
      <Row label="SKU prefix" value={category.sku_prefix || null} />
      {subCount != null && <Row label="Subcategories" value={String(subCount)} />}
      {productCount != null && <Row label="Products" value={String(productCount)} />}
      <Row label="Return policy" value={policyText(category.return_allowed, category.return_window_days)} />
      <Row
        label="Replacement policy"
        value={policyText(category.replacement_allowed, category.replacement_window_days)}
      />
      <Row label="Description" value={category.description} />
    </div>
  )
}
