'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { BookOpen, Clock, File, Film, Headphones, Infinity as InfinityIcon, Repeat, SearchX, Store } from 'lucide-react'
import { useVaultSearch } from './VaultShell'
import {
  KIND_LABEL,
  LIBRARY_FILTERS,
  accessLabel,
  countByKind,
  filterLibrary,
  primaryKind,
  type LibraryFilter,
  type LibraryItem,
  type LibraryKind,
} from '@/lib/vault/library-filter'

const KIND_ICON: Record<LibraryKind, typeof Film> = { video: Film, audio: Headphones, pdf: BookOpen, other: File }

export default function LibraryGrid({
  items,
  storeUrl,
  initialQuery = '',
}: {
  items: LibraryItem[]
  storeUrl: string
  initialQuery?: string
}) {
  const { query, setQuery } = useVaultSearch()
  const [kind, setKind] = useState<LibraryFilter>('all')

  useEffect(() => {
    if (initialQuery) setQuery(initialQuery)
  }, [initialQuery, setQuery])

  const counts = useMemo(() => countByKind(items), [items])
  const visible = useMemo(() => filterLibrary(items, { kind, query }), [items, kind, query])
  const filtering = kind !== 'all' || query.trim() !== ''

  return (
    <main className="mx-auto max-w-7xl px-4 pb-16 pt-8 sm:px-6 sm:pt-10">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">Your library</h1>
          <p className="mt-1 text-sm text-neutral-400">
            {items.length === 0
              ? 'Digital purchases appear here.'
              : `${items.length} ${items.length === 1 ? 'item' : 'items'}${filtering ? ` · ${visible.length} shown` : ''}`}
          </p>
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState storeUrl={storeUrl} />
      ) : (
        <>
          <div role="tablist" aria-label="Filter by type" className="-mx-4 mb-6 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
            {LIBRARY_FILTERS.filter(f => f.id === 'all' || counts[f.id] > 0).map(f => {
              const active = kind === f.id
              return (
                <button
                  key={f.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setKind(f.id)}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                    active
                      ? 'bg-white text-neutral-950'
                      : 'bg-white/[0.05] text-neutral-300 ring-1 ring-inset ring-white/[0.08] hover:bg-white/[0.09]'
                  }`}
                >
                  {f.label}
                  <span className="text-xs tabular-nums text-neutral-500">{counts[f.id]}</span>
                </button>
              )
            })}
          </div>

          {visible.length === 0 ? (
            <div className="flex flex-col items-center rounded-2xl border border-dashed border-white/10 px-6 py-16 text-center">
              <SearchX className="h-8 w-8 text-neutral-500" aria-hidden />
              <p className="mt-3 font-medium text-neutral-200">No matches</p>
              <p className="mt-1 text-sm text-neutral-500">Nothing in your library matches the current search or filter.</p>
              <button
                type="button"
                onClick={() => {
                  setKind('all')
                  setQuery('')
                }}
                className="mt-5 rounded-lg bg-white/[0.08] px-4 py-2 text-sm text-neutral-100 hover:bg-white/[0.12] focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              >
                Clear filters
              </button>
            </div>
          ) : (
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4 xl:grid-cols-5">
              {visible.map(it => (
                <LibraryCard key={it.product_id} item={it} />
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  )
}

function LibraryCard({ item }: { item: LibraryItem }) {
  const kind = primaryKind(item.kinds)
  const Icon = KIND_ICON[kind]
  const wide = kind === 'video'
  const lifetime = !item.access_expires_at

  return (
    <li className={wide ? 'col-span-2' : undefined}>
      <Link
        href={`/item/${encodeURIComponent(item.product_id)}`}
        className="group block overflow-hidden rounded-xl bg-neutral-900 ring-1 ring-white/[0.06] transition duration-200 hover:-translate-y-0.5 hover:ring-white/20 hover:shadow-xl hover:shadow-black/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
      >
        <div className={`relative overflow-hidden bg-neutral-800 ${wide ? 'aspect-video' : 'aspect-[3/4]'}`}>
          {item.cover_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.cover_url}
              alt=""
              loading="lazy"
              draggable={false}
              className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-neutral-800 to-neutral-900">
              <Icon className="h-10 w-10 text-neutral-600" aria-hidden />
            </div>
          )}
          <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2">
            <span className="inline-flex items-center gap-1 rounded-md bg-black/65 px-1.5 py-0.5 text-[11px] font-medium text-white backdrop-blur">
              <Icon className="h-3 w-3" aria-hidden />
              {KIND_LABEL[kind]}
            </span>
            {item.source === 'subscription' ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-indigo-500/85 px-1.5 py-0.5 text-[11px] font-medium text-white backdrop-blur">
                <Repeat className="h-3 w-3" aria-hidden />
                Subscription
              </span>
            ) : null}
          </div>
        </div>
        <div className="p-3">
          <p className="line-clamp-2 text-sm font-medium leading-snug text-neutral-100 group-hover:text-white">{item.title}</p>
          <p className={`mt-1.5 flex items-center gap-1 text-xs ${lifetime ? 'text-neutral-500' : 'text-amber-300/90'}`}>
            {lifetime ? <InfinityIcon className="h-3.5 w-3.5" aria-hidden /> : <Clock className="h-3.5 w-3.5" aria-hidden />}
            {accessLabel(item.access_expires_at)}
            {item.file_count > 1 ? <span className="text-neutral-500"> · {item.file_count} files</span> : null}
          </p>
        </div>
      </Link>
    </li>
  )
}

function EmptyState({ storeUrl }: { storeUrl: string }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.03] to-transparent px-6 py-20 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-500/10 ring-1 ring-indigo-400/20">
        <BookOpen className="h-7 w-7 text-indigo-300" aria-hidden />
      </div>
      <h2 className="mt-5 text-lg font-semibold text-white">No purchases yet</h2>
      <p className="mt-1 max-w-sm text-sm text-neutral-400">
        Videos, audio, books and other digital products you buy show up here, ready to open.
      </p>
      <a
        href={storeUrl}
        className="mt-6 inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-neutral-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
      >
        <Store className="h-4 w-4" aria-hidden />
        Browse the store
      </a>
    </div>
  )
}
