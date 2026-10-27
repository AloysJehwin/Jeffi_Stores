'use client'

import { useCallback, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import type { SortDir } from '@/components/admin/sortOptions'

// The one list sort: ?sort=<key>&dir=asc|desc, written by clicking column titles.
// A header goes natural direction → flipped → cleared (back to the list's default order).

export type SortType = 'text' | 'number' | 'date'

export interface SortCol {
  key: string
  label: string
  type?: SortType
}

export const naturalDir = (type: SortType = 'text'): SortDir => (type === 'text' ? 'asc' : 'desc')

export interface ListSortState {
  sort: string | null
  dir: SortDir
  set: (key: string | null, dir?: SortDir) => void
  /** Header click: natural → flipped → cleared. */
  cycle: (key: string, type?: SortType) => void
  stateOf: (key: string) => SortDir | null
}

/** `ns` namespaces the params (`<ns>.sort`) when several client-sorted tables share a page. */
export function useListSort(ns?: string): ListSortState {
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const sortP = ns ? `${ns}.sort` : 'sort'
  const dirP = ns ? `${ns}.dir` : 'dir'
  const sort = sp.get(sortP)
  const dir: SortDir = sp.get(dirP) === 'asc' ? 'asc' : 'desc'

  const set = useCallback(
    (key: string | null, d?: SortDir) => {
      const q = new URLSearchParams(sp.toString())
      if (key) {
        q.set(sortP, key)
        q.set(dirP, d ?? 'desc')
      } else {
        q.delete(sortP)
        q.delete(dirP)
      }
      if (!ns) q.delete('page')
      const qs = q.toString()
      router.push(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false })
    },
    [sp, router, pathname, sortP, dirP, ns]
  )

  const cycle = useCallback(
    (key: string, type?: SortType) => {
      const natural = naturalDir(type)
      if (sort !== key) set(key, natural)
      else if (dir === natural) set(key, natural === 'asc' ? 'desc' : 'asc')
      else set(null)
    },
    [sort, dir, set]
  )

  const stateOf = useCallback((key: string) => (sort === key ? dir : null), [sort, dir])
  return { sort, dir, set, cycle, stateOf }
}

export function SortArrow({ state }: { state: SortDir | null }) {
  if (state === 'asc') return <ArrowUp className="h-3 w-3" />
  if (state === 'desc') return <ArrowDown className="h-3 w-3" />
  return <ArrowUpDown className="h-3 w-3 opacity-30" />
}

/** A sortable header cell for hand-rolled tables; same behaviour as DataTable's headers. */
export function SortTh({
  col,
  className = '',
  align = 'left',
  children,
  ns,
}: {
  col: SortCol
  className?: string
  align?: 'left' | 'right' | 'center'
  children?: ReactNode
  ns?: string
}) {
  const { stateOf, cycle } = useListSort(ns)
  const s = stateOf(col.key)
  return (
    <th
      aria-sort={s === 'asc' ? 'ascending' : s === 'desc' ? 'descending' : undefined}
      className={`cursor-pointer select-none whitespace-nowrap hover:text-foreground ${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'} ${className}`}
      onClick={() => cycle(col.key, col.type)}
    >
      <span className="inline-flex items-center gap-1">
        {children ?? col.label}
        <SortArrow state={s} />
      </span>
    </th>
  )
}
