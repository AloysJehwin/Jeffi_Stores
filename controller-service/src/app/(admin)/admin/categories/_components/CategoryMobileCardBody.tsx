import CategoryIcon from '@/components/visitor/CategoryIcon'

interface CardCategory {
  name: string
  slug: string
  icon_name: string | null
  display_order: number
  is_active: boolean
}

interface Props {
  category: CardCategory
  isSubcat?: boolean
  subCount?: number
}

export default function CategoryMobileCardBody({ category, isSubcat, subCount }: Props) {
  return (
    <>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={`rounded-md flex items-center justify-center shrink-0 ${
              isSubcat ? 'w-6 h-6 bg-surface-secondary' : 'w-7 h-7 bg-accent-100 dark:bg-accent-900/30'
            }`}
          >
            <CategoryIcon
              iconName={category.icon_name}
              categoryName={category.name}
              className={isSubcat ? 'w-3.5 h-3.5 text-foreground-muted' : 'w-4 h-4 text-accent-600 dark:text-accent-400'}
            />
          </div>
          {isSubcat && <span className="text-foreground-muted">&#9492;</span>}
          <span className={`truncate ${isSubcat ? 'text-sm text-foreground' : 'text-sm font-semibold text-foreground'}`}>
            {category.name}
          </span>
          {!isSubcat && subCount != null && subCount > 0 && (
            <span className="text-xs text-foreground-muted bg-surface-secondary px-1.5 py-0.5 rounded-full">
              {subCount}
            </span>
          )}
        </div>
        <span
          className={`flex-shrink-0 px-2 py-0.5 text-xs font-semibold rounded-full ${
            category.is_active
              ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
              : 'bg-surface-secondary text-foreground'
          }`}
        >
          {category.is_active ? 'Active' : 'Inactive'}
        </span>
      </div>
      <div className="flex items-center justify-between text-xs text-foreground-muted">
        <span className="truncate">{category.slug}</span>
        <span className="flex-shrink-0 ml-2">Order: {category.display_order}</span>
      </div>
    </>
  )
}
