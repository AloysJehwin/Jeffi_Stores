'use client'

import { useState, useEffect, useRef } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useToast } from '@/contexts/ToastContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import ImgWithSkeleton from '@/components/ui/ImgWithSkeleton'
import { ap } from '@/lib/shared/admin-path'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { Tabs } from '@/components/admin/channels/ui'
import { Dialog, EmptyState, InfiniteFooter, PageBody, PageHeader, badgeCls, fetchJson, fieldInputCls, useInfiniteList } from '@/components/admin/kit'
import { Check, MessageSquare, Search, ExternalLink, Trash2, AlertTriangle } from 'lucide-react'
import ReviewsOverview from './_components/ReviewsOverview'

interface Review {
  id: string
  rating: number
  title: string | null
  comment: string
  is_verified_purchase: boolean
  is_approved: boolean
  image_urls: string[]
  image_thumbnail_urls: string[]
  created_at: string
  users: {
    first_name: string
    last_name: string
    email: string
  }
  products: {
    name: string
    slug: string
  }
}

function Stars({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(star => (
        <svg
          key={star}
          className={`w-4 h-4 ${star <= rating ? 'text-amber-400' : 'text-border-default'}`}
          viewBox="0 0 24 24"
          fill={star <= rating ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth={star <= rating ? 0 : 1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
          />
        </svg>
      ))}
    </div>
  )
}

type View = 'overview' | 'reviews'

export default function ReviewsClient({ canWrite = false }: { canWrite?: boolean }) {
  const searchParams = useSearchParams()
  const router = useRouter()
  // Old links (?filter / ?q without ?view) still open the list.
  const initial: View =
    searchParams.get('view') === 'reviews' ||
    (!searchParams.get('view') && (searchParams.has('filter') || searchParams.has('q')))
      ? 'reviews'
      : 'overview'
  const [view, setView] = useState<View>(initial)

  useEffect(() => {
    const v = searchParams.get('view')
    if (v === 'reviews' || v === 'overview') setView(v)
  }, [searchParams])

  function switchView(v: View) {
    setView(v)
    const p = new URLSearchParams(window.location.search)
    p.set('view', v)
    router.replace(ap(`/admin/reviews?${p.toString()}`), { scroll: false })
  }

  return (
    <PageBody>
      <PageHeader
        title="Reviews"
        description="Ratings, review requests and moderation of customer reviews before they appear on product pages"
      />
      <Tabs
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'reviews', label: 'Reviews' },
        ]}
        value={view}
        onChange={switchView}
      />
      {view === 'overview' ? <ReviewsOverview /> : <ReviewsList canWrite={canWrite} />}
    </PageBody>
  )
}

function ReviewsList({ canWrite: canWriteProp = false }: { canWrite?: boolean }) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const hasWriteScope = useCanWrite('reviews:write')
  const canWrite = canWriteProp && hasWriteScope

  const [filter, setFilter] = useState<'all' | 'pending' | 'approved'>(
    (searchParams.get('filter') as 'all' | 'pending' | 'approved') || 'pending'
  )
  const [search, setSearch] = useState(searchParams.get('q') || '')
  const [query, setQuery] = useState(search.trim())
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const { showToast } = useToast()
  const confirm = useConfirm()
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const PAGE_SIZE = 25
  const list = useInfiniteList<Review>({
    key: `${filter}|${query}`,
    pageSize: PAGE_SIZE,
    getKey: r => r.id,
    fetchPage: async (p, signal) => {
      const params = new URLSearchParams({ filter })
      if (query) params.set('q', query)
      params.set('page', String(p))
      params.set('pageSize', String(PAGE_SIZE))
      const data = await fetchJson(`/api/admin/reviews?${params}`, signal)
      return { rows: data.reviews || [], total: data.total || 0 }
    },
  })
  const reviews = list.rows
  const isLoading = list.loading

  useEffect(() => {
    if (!lightboxUrl) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxUrl(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightboxUrl])

  function syncUrl(patch: Record<string, string>) {
    const p = new URLSearchParams(window.location.search)
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v)
      else p.delete(k)
    }
    router.replace(ap(`/admin/reviews?${p.toString()}`), { scroll: false })
  }

  function handleSearchChange(val: string) {
    setSearch(val)
    syncUrl({ q: val })
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => setQuery(val.trim()), 300)
  }

  const handleApprove = async (reviewId: string) => {
    try {
      const response = await fetch('/api/admin/reviews', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewId, action: 'approve' }),
      })
      if (response.ok) {
        list.setRows(rows => (filter === 'pending' ? rows.filter(r => r.id !== reviewId) : rows.map(r => (r.id === reviewId ? { ...r, is_approved: true } : r))))
        showToast('Review approved', 'success')
      } else {
        showToast('Failed to approve review', 'error')
      }
    } catch {
      showToast('Failed to approve review', 'error')
    }
  }

  const handleReject = async (reviewId: string) => {
    const ok = await confirm({
      title: 'Delete Review',
      message: 'Delete this review? This action cannot be undone.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      variant: 'danger',
    })
    if (!ok) return
    try {
      const response = await fetch('/api/admin/reviews', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewId, action: 'reject' }),
      })
      if (response.ok) {
        list.setRows(rows => rows.filter(r => r.id !== reviewId))
        showToast('Review deleted', 'success')
      } else {
        showToast('Failed to delete review', 'error')
      }
    } catch {
      showToast('Failed to delete review', 'error')
    }
  }

  const TABS = [
    { key: 'pending', label: 'Pending' },
    { key: 'approved', label: 'Approved' },
    { key: 'all', label: 'All' },
  ] as const

  const pendingCount = reviews.filter(r => !r.is_approved).length

  return (
    <div>
      {filter === 'pending' && !isLoading && pendingCount > 0 && (
        <div className="mb-3 flex justify-end">
          <span className={`${badgeCls('amber')} inline-flex items-center gap-1.5 text-xs`}>
            <AlertTriangle className="h-3.5 w-3.5" />
            {pendingCount} awaiting approval
          </span>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex h-control rounded-lg border border-border-default bg-surface-elevated p-0.5">
          {TABS.map(tab => (
            <button
              key={tab.key}
              type="button"
              onClick={() => {
                setFilter(tab.key)
                syncUrl({ filter: tab.key })
              }}
              className={`h-full rounded-md px-3 text-xs font-medium transition-colors ${filter === tab.key ? 'bg-accent-500 text-white' : 'text-foreground-muted hover:text-foreground'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="relative min-w-[200px] max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted" />
          <input
            type="text"
            value={search}
            onChange={e => handleSearchChange(e.target.value)}
            placeholder="Search by product or reviewer…"
            aria-label="Search"
            className={`${fieldInputCls} pl-9`}
          />
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-surface-elevated rounded-xl border border-border-default p-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-full bg-surface-secondary animate-pulse shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-1/3 bg-surface-secondary rounded animate-pulse" />
                  <div className="h-3 w-1/4 bg-surface-secondary rounded animate-pulse" />
                  <div className="h-3 w-full bg-surface-secondary rounded animate-pulse" />
                  <div className="h-3 w-5/6 bg-surface-secondary rounded animate-pulse" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : reviews.length === 0 ? (
        <EmptyState
          icon={<MessageSquare className="h-5 w-5" />}
          title="No reviews found"
          body={
            filter === 'pending' ? 'All caught up — no reviews awaiting approval.' : 'No reviews match your filters.'
          }
        />
      ) : (
        <div className="space-y-3">
          {reviews.map(review => {
            const initials =
              `${review.users.first_name?.[0] || ''}${review.users.last_name?.[0] || ''}`.toUpperCase() || '?'
            const isExpanded = expandedId === review.id
            return (
              <div
                key={review.id}
                className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden"
              >
                {/* Card header row */}
                <div className="px-4 pt-4 pb-3">
                  <div className="flex items-start gap-3">
                    {/* Avatar */}
                    <div className="w-9 h-9 rounded-full bg-accent-500/10 flex items-center justify-center text-sm font-bold text-accent-500 shrink-0 mt-0.5">
                      {initials}
                    </div>

                    {/* Main content */}
                    <div className="flex-1 min-w-0">
                      {/* Top row: name + badges + date */}
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1">
                        <span className="font-semibold text-sm text-foreground">
                          {review.users.first_name} {review.users.last_name}
                        </span>
                        <span className="text-xs text-foreground-muted hidden sm:inline">{review.users.email}</span>
                        {review.is_verified_purchase && (
                          <span className={`${badgeCls('green')} inline-flex items-center gap-1`}>
                            <Check className="h-3 w-3" />
                            Verified
                          </span>
                        )}
                        {review.is_approved ? (
                          <span className={badgeCls('blue')}>Approved</span>
                        ) : (
                          <span className={badgeCls('amber')}>Pending</span>
                        )}
                        <span className="text-xs text-foreground-muted ml-auto">
                          {new Date(review.created_at).toLocaleDateString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </span>
                      </div>

                      {/* Stars + product link */}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2">
                        <Stars rating={review.rating} />
                        <a
                          href={`/products/${review.products.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-accent-500 hover:underline font-medium truncate max-w-[160px] sm:max-w-xs md:max-w-md"
                        >
                          <ExternalLink className="h-3 w-3 shrink-0" />
                          {review.products.name}
                        </a>
                      </div>

                      {/* Review text */}
                      {review.title && <p className="font-semibold text-sm text-foreground mb-0.5 break-words">{review.title}</p>}
                      <p
                        className={`text-sm text-foreground-secondary leading-relaxed whitespace-pre-wrap break-words ${!isExpanded ? 'line-clamp-3' : ''}`}
                      >
                        {review.comment}
                      </p>
                      {review.comment.length > 160 && (
                        <button
                          type="button"
                          onClick={() => setExpandedId(isExpanded ? null : review.id)}
                          className="text-xs text-accent-500 hover:underline mt-0.5"
                        >
                          {isExpanded ? 'Show less' : 'Read more'}
                        </button>
                      )}

                      {/* Images */}
                      {review.image_urls?.length > 0 && (
                        <div className="flex gap-2 mt-2.5 flex-wrap">
                          {review.image_urls.map((url, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => setLightboxUrl(url)}
                              className="w-16 h-16 rounded-lg overflow-hidden border border-border-secondary hover:border-accent-500 transition-colors shrink-0"
                            >
                              <ImgWithSkeleton
                                src={review.image_thumbnail_urls?.[idx] || url}
                                alt=""
                                className="w-full h-full object-cover"
                              />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Action bar */}
                {!review.is_approved && canWrite && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-border-default bg-surface-secondary/40 px-4 py-2.5">
                    <button
                      type="button"
                      onClick={() => handleApprove(review.id)}
                      className="control-md bg-green-600 font-medium text-white hover:bg-green-700"
                    >
                      <Check className="h-4 w-4" />
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => handleReject(review.id)}
                      className="control-md border border-red-500/40 font-medium text-red-600 hover:bg-red-500/10 dark:text-red-400"
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {!isLoading && <InfiniteFooter shown={reviews.length} control={list} noun="reviews" />}

      <Dialog open={!!lightboxUrl} onClose={() => setLightboxUrl(null)} title="Review photo" size="xl" zIndex="z-[300]">
        {lightboxUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={lightboxUrl} alt="" className="mx-auto max-h-[75vh] max-w-full rounded-lg object-contain" />
        )}
      </Dialog>
    </div>
  )
}
