import { Fragment } from 'react'
import type { ReactNode } from 'react'

const MIN_WIDTH_CLASS = {
  none: '',
  md: 'min-w-[720px]',
  lg: 'min-w-[900px]',
  xl: 'min-w-[1100px]',
} as const

type MinWidth = keyof typeof MIN_WIDTH_CLASS

interface ResponsiveListProps<T> {
  items: T[]
  getKey: (item: T) => string | number
  renderCard: (item: T) => ReactNode
  tableBody: ReactNode
  tableHead?: ReactNode
  emptyState?: ReactNode
  hasOwnEmptyState?: boolean
  pagination?: ReactNode
  minWidth?: MinWidth
  className?: string
  // When provided, replaces the default per-item card mapping in the mobile
  // section - lets a caller own the whole mobile experience (tap, sheets)
  // while the desktop table stays driven by tableHead/tableBody.
  mobileList?: ReactNode
}

const DEFAULT_EMPTY = (
  <div className="bg-surface-elevated rounded-lg border border-border-default p-8 text-center text-foreground-muted">
    No results found.
  </div>
)

export default function ResponsiveList<T>({
  items,
  getKey,
  renderCard,
  tableBody,
  tableHead,
  emptyState,
  hasOwnEmptyState,
  pagination,
  minWidth = 'lg',
  className = '',
  mobileList,
}: ResponsiveListProps<T>) {
  const isEmpty = items.length === 0

  return (
    <>
      <div className={`md:hidden space-y-3 ${className}`}>
        {!isEmpty ? (
          mobileList ?? items.map(item => <Fragment key={getKey(item)}>{renderCard(item)}</Fragment>)
        ) : (
          !hasOwnEmptyState && (emptyState ?? DEFAULT_EMPTY)
        )}
        {pagination}
      </div>

      <div className="hidden md:block bg-surface-elevated rounded-lg shadow-sm border border-border-default overflow-hidden">
        <div className="overflow-x-auto">
          <table className={`w-full ${MIN_WIDTH_CLASS[minWidth]} divide-y divide-border-default`}>
            {tableHead && (
              <thead className="bg-surface-secondary">
                <tr>{tableHead}</tr>
              </thead>
            )}
            {tableBody}
          </table>
        </div>
      </div>

      {pagination && (
        <div className="hidden md:block px-6 py-3 border border-border-default border-t-0 rounded-b-lg bg-surface-elevated">
          {pagination}
        </div>
      )}
    </>
  )
}
