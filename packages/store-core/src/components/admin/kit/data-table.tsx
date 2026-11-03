'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Search, X } from 'lucide-react'
import Select from '@/components/ui/Select'
import AdminTypeahead from '@/components/admin/AdminTypeahead'
import RowActions, { type RowAction } from '@/components/admin/RowActions'
import { useConfirm } from '@/contexts/ConfirmContext'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { EmptyState, ErrorState, TableSkeleton, type EmptyStateProps } from './states'
import { InfiniteFooter, useReveal, useServerPages, type InfiniteControl } from './infinite'
import { SortArrow, useListSort, type SortType } from './list-sort'

// List tables, infinite scroll (no page buttons). Client mode sorts in memory and reveals
// pageSize rows at a time, or shows rows an `infinite` source (useInfiniteList) fetched so far.
// Server mode reads and writes the page's existing query params (?page, ?sort&dir, filters,
// search); rows of ?page=1..N accumulate client-side (see useServerPages). Both modes keep the
// sort in ?sort&dir (see list-sort); column titles are the only sort control. A server page cannot pass `cols` (functions) across the
// client boundary: define the columns in a small client component next to the page.

export interface DataCol<T> {
  key: string
  label: ReactNode
  render: (r: T) => ReactNode
  /** Client-mode sort value. */
  sort?: (r: T) => number | string
  /** The ?sort value this column writes: required in server mode; client mode defaults to `key`.
   *  With `infinite`, a column with sortParam is sorted by the API, not in memory. */
  sortParam?: string
  /** Labels and first-click direction; defaults to number for `num` columns, else text. */
  sortType?: SortType
  num?: boolean
  /** Hide the column below a breakpoint (the mobile card covers small screens anyway). */
  hideBelow?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}

export interface FilterDef {
  name: string
  label: string
  options: { value: string; label: string }[]
  allLabel?: string
}

export interface BulkAction<T> {
  key: string
  label: string
  icon?: ReactNode
  danger?: boolean
  confirm?: string
  scope?: string
  onRun: (rows: T[]) => void | Promise<void>
}

export interface DataTableProps<T> {
  rows: T[]
  cols: DataCol<T>[]
  rowKey: (r: T) => string
  mode?: 'client' | 'server'
  /** Server mode: total matching rows, current page, rows per page. */
  total?: number
  page?: number
  pageSize?: number
  /** Server mode: page link builder; defaults to the current URL with ?page set. */
  pageHref?: (page: number) => string
  /** Client mode fed page by page from an API (useInfiniteList): rows are everything loaded so far. */
  infinite?: InfiniteControl & { loading?: boolean }
  /** Rows removed locally (deleted) that earlier accumulated pages may still hold. */
  hide?: (r: T) => boolean
  /** Footer wording: "Showing X of Y <noun>". */
  noun?: string
  /** Search box. Server mode writes ?param; client mode filters rows by `match`. */
  search?: { placeholder: string; param?: string; suggestType?: string; match?: (r: T) => string }
  filters?: FilterDef[]
  /** Extra controls at the right end of the toolbar. */
  toolbar?: ReactNode
  selectable?: boolean
  bulkActions?: BulkAction<T>[]
  rowActions?: (r: T) => RowAction[]
  onRowClick?: (r: T) => void
  /** Card per row below md. */
  mobileCard?: (r: T) => ReactNode
  /** Replace the mobile rendering entirely (an existing MobileList). A function gets the loaded rows. */
  mobile?: ReactNode | ((rows: T[]) => ReactNode)
  loading?: boolean
  error?: string | null
  empty?: string | EmptyStateProps
  /** Inside a card that already has a border. */
  bare?: boolean
  /** Client mode: namespaces ?sort when several tables share a page. */
  sortNs?: string
}

const HIDE = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell', xl: 'hidden xl:table-cell' }

function useQuery() {
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const set = useCallback(
    (patch: Record<string, string | null>, opts: { keepPage?: boolean } = {}) => {
      const q = new URLSearchParams(sp.toString())
      for (const [k, v] of Object.entries(patch)) {
        if (v) q.set(k, v)
        else q.delete(k)
      }
      if (!opts.keepPage) q.delete('page')
      const qs = q.toString()
      router.push(`${pathname}${qs ? `?${qs}` : ''}`)
    },
    [sp, router, pathname]
  )
  return { sp, set, pathname, router }
}

export interface DataToolbarProps {
  search?: DataTableProps<unknown>['search']
  filters?: FilterDef[]
  /** Active filters the toolbar doesn't render (an advanced panel), so Clear still shows. */
  activeExtra?: number
  /** More params Clear removes; `tab`, `view` and `edit` always survive. */
  clear?: string[]
  /** Hide the filter selects on small screens (a filter sheet covers them). */
  hideFiltersBelow?: 'sm' | 'md' | 'lg'
  children?: ReactNode
}

const HIDE_BELOW = { sm: 'hidden sm:block', md: 'hidden md:block', lg: 'hidden lg:block' }

/** Search + filter selects + clear, bound to the URL with the same semantics as AdminFilters. */
export function DataToolbar({ search, filters = [], activeExtra = 0, clear = [], hideFiltersBelow, children }: DataToolbarProps) {
  const { sp, set, router } = useQuery()
  const param = search?.param ?? 'search'
  const [q, setQ] = useState(sp.get(param) || '')
  useEffect(() => setQ(sp.get(param) || ''), [sp, param])
  const active = filters.some(f => sp.get(f.name)) || !!sp.get(param) || activeExtra > 0
  const clearAll = () => set(Object.fromEntries([param, ...filters.map(f => f.name), ...clear].map(k => [k, null])))
  return (
    <div className="flex items-center gap-2 overflow-x-auto -mx-4 px-4 pb-1">
      {search &&
        (search.suggestType ? (
          <div className="min-w-[200px] flex-1 shrink-0">
            <AdminTypeahead
              type={search.suggestType}
              value={q}
              onChange={setQ}
              onSelect={item => (item.href ? router.push(item.href) : set({ [param]: q.trim() || null }))}
              onEnter={val => set({ [param]: val.trim() || null })}
              placeholder={search.placeholder}
            />
          </div>
        ) : (
          <form
            className="relative min-w-[200px] flex-1 shrink-0"
            onSubmit={e => {
              e.preventDefault()
              set({ [param]: q.trim() || null })
            }}
          >
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted" />
            <input
              name={param}
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder={search.placeholder}
              aria-label="Search"
              className="field-md w-full border border-border-default bg-surface-elevated pl-9 text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500/40"
            />
          </form>
        ))}
      {filters.map(f => (
        <div key={f.name} className={`w-[160px] shrink-0 ${hideFiltersBelow ? HIDE_BELOW[hideFiltersBelow] : ''}`}>
          <Select<string>
            className="w-full"
            value={sp.get(f.name) || ''}
            placeholder={f.label}
            options={[{ value: '', label: `${f.label}: ${f.allLabel ?? 'All'}` }, ...f.options.map(o => ({ value: o.value, label: `${f.label}: ${o.label}` }))]}
            onChange={v => set({ [f.name]: v || null })}
          />
        </div>
      ))}
      {active && (
        <button type="button" onClick={clearAll} className="control-md shrink-0 border border-border-default text-foreground-secondary hover:bg-surface-secondary">
          <X className="h-4 w-4" />
          Clear
        </button>
      )}
      {children && <div className="ml-auto flex items-center gap-2 shrink-0">{children}</div>}
    </div>
  )
}

function BulkButton<T>({ a, rows, done }: { a: BulkAction<T>; rows: T[]; done: () => void }) {
  const confirm = useConfirm()
  const allowed = useCanWrite(a.scope ?? 'none')
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      disabled={busy || (!!a.scope && !allowed)}
      onClick={async () => {
        if (a.confirm && !(await confirm({ message: a.confirm, variant: a.danger ? 'danger' : 'default' }))) return
        setBusy(true)
        try {
          await a.onRun(rows)
          done()
        } finally {
          setBusy(false)
        }
      }}
      className={`control-sm border disabled:opacity-50 ${a.danger ? 'border-red-500/40 text-red-600 dark:text-red-400 hover:bg-red-500/10' : 'border-border-default text-foreground hover:bg-surface-secondary'}`}
    >
      {a.icon}
      {a.label}
    </button>
  )
}

export function DataTable<T>(props: DataTableProps<T>) {
  const { rows, cols, rowKey, mode = 'client', pageSize = 25, search, filters, toolbar, selectable, bulkActions, rowActions, onRowClick, mobileCard, mobile, empty, bare, infinite, noun, hide, sortNs } = props
  const server = mode === 'server'
  const listSort = useListSort(server ? undefined : sortNs)
  const sortKey = listSort.sort
  const desc = listSort.dir === 'desc'
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const shownRows = useMemo(() => {
    if (server) return rows
    let r = rows
    if (search?.match && q.trim()) {
      const needle = q.trim().toLowerCase()
      r = r.filter(x => search.match!(x).toLowerCase().includes(needle))
    }
    const c = sortKey ? cols.find(c => (c.sortParam ?? c.key) === sortKey) : undefined
    if (c?.sort && !(infinite && c.sortParam)) {
      r = [...r].sort((a, b) => {
        const x = c.sort!(a)
        const y = c.sort!(b)
        return x < y ? -1 : x > y ? 1 : 0
      })
      if (desc) r.reverse()
    }
    return r
  }, [server, rows, cols, sortKey, desc, q, search, infinite])

  const sv = useServerPages({ rows: server ? rows : [], page: server ? (props.page ?? 1) : 1, total: server ? (props.total ?? rows.length) : 0, rowKey, pageHref: props.pageHref })
  const reveal = useReveal(shownRows, pageSize, `${q}|${sortKey}|${desc}`)
  const visibleAll = server ? sv.rows : infinite ? shownRows : reveal.shown
  const visible = hide ? visibleAll.filter(r => !hide(r)) : visibleAll
  const control: InfiniteControl = server ? sv.control : infinite ? { ...infinite, total: q.trim() ? null : infinite.total } : reveal.control
  const loading = props.loading || (server && sv.resetting) || !!infinite?.loading
  const firstPageError = infinite && !rows.length ? infinite.error : null
  const error = props.error ?? firstPageError
  const loadedRows = server ? sv.rows : rows

  const sortParamOf = (c: DataCol<T>) => (server ? c.sortParam : (c.sortParam ?? (c.sort ? c.key : undefined)))
  const sortTypeOf = (c: DataCol<T>): SortType => c.sortType ?? (c.num ? 'number' : 'text')
  const onHeader = (c: DataCol<T>) => {
    const key = sortParamOf(c)
    if (key) listSort.cycle(key, sortTypeOf(c))
  }
  const sortState = (c: DataCol<T>) => {
    const key = sortParamOf(c)
    return key ? listSort.stateOf(key) : null
  }

  const keys = visible.map(rowKey)
  const allOn = keys.length > 0 && keys.every(k => selected.has(k))
  const selectedRows = loadedRows.filter(r => selected.has(rowKey(r)))
  const emptyProps: EmptyStateProps = typeof empty === 'string' ? { title: empty } : (empty ?? { title: 'Nothing here yet.' })

  const hasToolbar = !!(search || filters?.length || toolbar)
  const toolbarNode = hasToolbar ? (
    server ? (
      <DataToolbar search={search as DataTableProps<unknown>['search']} filters={filters}>
        {toolbar}
      </DataToolbar>
    ) : (
      <div className="flex flex-wrap items-center gap-2">
        {search && (
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted" />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder={search.placeholder}
              aria-label="Search"
              className="field-md w-full border border-border-default bg-surface-elevated pl-9 text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500/40"
            />
          </div>
        )}
        {toolbar && <div className="ml-auto flex flex-wrap items-center gap-2">{toolbar}</div>}
      </div>
    )
  ) : null

  let body: ReactNode
  if (loading) body = <TableSkeleton cols={Math.min(cols.length, 6)} />
  else if (error)
    body = (
      <ErrorState
        body={error}
        bare={bare}
        actionNode={
          firstPageError && !props.error ? (
            <button type="button" onClick={infinite?.retry ?? infinite?.loadMore} className="control-sm border border-border-default text-foreground hover:bg-surface-secondary">
              Retry
            </button>
          ) : undefined
        }
      />
    )
  else if (!visible.length) body = <EmptyState {...emptyProps} bare={bare} />
  else
    body = (
      <>
        {(mobile || mobileCard) && <div className="space-y-2 md:hidden">{typeof mobile === 'function' ? mobile(visible) : (mobile ?? visible.map(r => <div key={rowKey(r)}>{mobileCard!(r)}</div>))}</div>}
        <div className={`${mobile || mobileCard ? 'hidden md:block' : ''} ${bare ? '' : 'rounded-xl border border-border-default bg-surface-elevated'} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-default bg-surface-secondary/50 text-xs text-foreground-muted">
                  {selectable && (
                    <th className="w-10 px-3 py-2.5">
                      <input
                        type="checkbox"
                        aria-label="Select all loaded rows"
                        title="Select all loaded rows"
                        checked={allOn}
                        onChange={() => setSelected(prev => (allOn ? new Set([...prev].filter(k => !keys.includes(k))) : new Set([...prev, ...keys])))}
                      />
                    </th>
                  )}
                  {cols.map(c => {
                    const s = sortState(c)
                    const sortable = !!sortParamOf(c)
                    return (
                      <th
                        key={c.key}
                        aria-sort={s === 'asc' ? 'ascending' : s === 'desc' ? 'descending' : undefined}
                        className={`whitespace-nowrap px-3 py-2.5 font-medium ${c.num ? 'text-right' : 'text-left'} ${c.hideBelow ? HIDE[c.hideBelow] : ''} ${sortable ? 'cursor-pointer select-none hover:text-foreground' : ''}`}
                        onClick={() => sortable && onHeader(c)}
                      >
                        <span className="inline-flex items-center gap-1">
                          {c.label}
                          {sortable && <SortArrow state={s} />}
                        </span>
                      </th>
                    )
                  })}
                  {rowActions && (
                    <th className="px-3 py-2.5 text-right font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {visible.map(r => {
                  const k = rowKey(r)
                  return (
                    <tr key={k} onClick={onRowClick ? () => onRowClick(r) : undefined} className={`border-b border-border-default/60 last:border-0 ${onRowClick ? 'cursor-pointer hover:bg-surface-secondary/60' : ''}`}>
                      {selectable && (
                        <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label="Select row"
                            checked={selected.has(k)}
                            onChange={() =>
                              setSelected(prev => {
                                const n = new Set(prev)
                                if (n.has(k)) n.delete(k)
                                else n.add(k)
                                return n
                              })
                            }
                          />
                        </td>
                      )}
                      {cols.map(c => (
                        <td key={c.key} className={`whitespace-nowrap px-3 py-2.5 align-middle ${c.num ? 'text-right tabular-nums' : ''} ${c.hideBelow ? HIDE[c.hideBelow] : ''} ${c.className ?? ''}`}>
                          {c.render(r)}
                        </td>
                      ))}
                      {rowActions && (
                        <td className="px-3 py-2.5 text-right" onClick={e => e.stopPropagation()}>
                          <RowActions actions={rowActions(r)} size="sm" />
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </>
    )

  return (
    <div className="min-w-0 space-y-3">
      {toolbarNode}
      {selectable && bulkActions && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-accent-500/40 bg-accent-500/5 px-3 py-2 text-sm">
          <span className="font-medium text-foreground">
            {selected.size} selected <span className="font-normal text-foreground-muted">(of {loadedRows.length} loaded)</span>
          </span>
          {bulkActions.map(a => (
            <BulkButton key={a.key} a={a} rows={selectedRows} done={() => setSelected(new Set())} />
          ))}
          <button type="button" onClick={() => setSelected(new Set())} className="ml-auto text-xs text-foreground-muted hover:text-foreground">
            Clear selection
          </button>
        </div>
      )}
      {body}
      {!loading && !props.error && !firstPageError && (visible.length > 0 || control.hasMore || control.error) && <InfiniteFooter shown={visible.length} control={control} noun={noun} />}
    </div>
  )
}
