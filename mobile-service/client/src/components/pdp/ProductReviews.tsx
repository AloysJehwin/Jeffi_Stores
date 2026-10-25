import { useState, type RefObject } from 'react'
import { Linking, Modal, Pressable, ScrollView, View } from 'react-native'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { Glyph, P } from './Glyph'
import { getProductReviews, type PdpReview } from '../../api/pdp'
import { SITE_URL } from '../../lib/links'
import { useAuthStore } from '../../stores/authStore'
import { showToast } from '../../stores/toastStore'
import { Text, Skeleton, SkeletonText } from '../../ui'

// Mirror of controller-service components/visitor/ProductReviews.tsx (list, rating summary, filter, sort,
// read-more and photo views). Writing/editing posts multipart images, so it hands off to the storefront page.

type Sort = 'recent' | 'highest' | 'lowest'
const SORTS: { value: Sort; label: string }[] = [
  { value: 'recent', label: 'Most recent' },
  { value: 'highest', label: 'Highest rated' },
  { value: 'lowest', label: 'Lowest rated' },
]

export function useReviews(productId: string) {
  return useQuery({ queryKey: ['pdp-reviews', productId], queryFn: () => getProductReviews(productId) })
}

export function reviewSummary(reviews: PdpReview[] | undefined) {
  const approved = (reviews ?? []).filter(r => r.is_approved)
  const average = approved.length > 0 ? approved.reduce((s, r) => s + r.rating, 0) / approved.length : 0
  return { approved, average, total: approved.length }
}

export function StarRow({ rating, size = 20 }: { rating: number; size?: number }) {
  return (
    <View className="flex-row" style={{ gap: 2 }}>
      {[1, 2, 3, 4, 5].map(star =>
        star <= rating ? (
          <Glyph key={star} d={P.star} solid size={size} className="text-yellow-400" />
        ) : (
          <Glyph key={star} d={P.star} size={size} strokeWidth={1.5} className="text-gray-300 dark:text-gray-600" />
        )
      )}
    </View>
  )
}

/** pdp/ReviewSummaryLink: compact rating near the title that jumps to the reviews section. */
export function ReviewSummaryLink({ average, total, onPress }: { average: number; total: number; onPress: () => void }) {
  if (total <= 0) return null
  const noun = total === 1 ? 'review' : 'reviews'
  const fill = Math.min(100, Math.max(0, (average / 5) * 100))
  const row = (cls: string) => (
    <View className="flex-row" style={{ width: 80 }}>
      {[0, 1, 2, 3, 4].map(i => (
        <Glyph key={i} d={P.star} solid size={16} className={cls} />
      ))}
    </View>
  )
  return (
    <View className="-mt-2 mb-4">
      <Pressable
        onPress={onPress}
        accessibilityLabel={`Rated ${average.toFixed(1)} out of 5 from ${total} ${noun}. Go to reviews`}
        className="flex-row items-center gap-2 self-start"
      >
        <View className="relative">
          {row('text-gray-300 dark:text-gray-600')}
          <View className="absolute bottom-0 left-0 top-0 overflow-hidden" style={{ width: `${fill}%` }}>
            {row('text-yellow-400')}
          </View>
        </View>
        <Text className="text-sm font-semibold text-foreground">{average.toFixed(1)}</Text>
        <Text className="text-sm text-foreground-muted">
          {total} {noun}
        </Text>
      </Pressable>
    </View>
  )
}

function RatingBar({ star, count, total, isActive, onPress }: { star: number; count: number; total: number; isActive: boolean; onPress: () => void }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0
  return (
    <Pressable
      onPress={onPress}
      disabled={count === 0}
      className={`w-full flex-row items-center gap-2 rounded px-1 py-0.5 ${isActive ? 'bg-accent-50 dark:bg-accent-900/20' : ''} ${count === 0 ? 'opacity-50' : ''}`}
    >
      <Text className={`w-3 text-right text-xs ${isActive ? 'font-semibold text-accent-600 dark:text-accent-400' : 'text-foreground-muted'}`}>{star}</Text>
      <Glyph d={P.star} solid size={14} className="text-yellow-400" />
      <View className="h-1.5 flex-1 overflow-hidden rounded-full bg-border-default">
        <View className="h-full rounded-full bg-yellow-400" style={{ width: `${pct}%` }} />
      </View>
      <Text className="w-6 text-xs text-foreground-muted">{count}</Text>
    </Pressable>
  )
}

const initialsOf = (r: PdpReview) => `${r.users?.first_name?.[0] || ''}${r.users?.last_name?.[0] || ''}`.toUpperCase() || '?'
const nameOf = (r: PdpReview) => `${r.users?.first_name ?? ''} ${r.users?.last_name ?? ''}`.trim()

function EmptyStars({ size }: { size: number }) {
  return (
    <View className="flex-row opacity-30" style={{ gap: 2 }}>
      {[1, 2, 3, 4, 5].map(s => (
        <Glyph key={s} d={P.star} solid size={size} className="text-yellow-400" />
      ))}
    </View>
  )
}

export default function ProductReviews({
  productId,
  productSlug,
  sectionRef,
}: {
  productId: string
  productSlug: string
  sectionRef: RefObject<View | null>
}) {
  const router = useRouter()
  const user = useAuthStore(s => s.user)
  const { data: reviews = [], isLoading } = useReviews(productId)
  const [filterStar, setFilterStar] = useState<number | null>(null)
  const [sortBy, setSortBy] = useState<Sort>('recent')
  const [sortOpen, setSortOpen] = useState(false)
  const [visibleCount, setVisibleCount] = useState(5)
  const [expanded, setExpanded] = useState<PdpReview | null>(null)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

  const { approved, average } = reviewSummary(reviews)
  const ratingCounts = [5, 4, 3, 2, 1].map(star => ({ star, count: approved.filter(r => r.rating === star).length }))
  const ownReview = user ? reviews.find(r => r.user_id === user.id) : null

  const filtered = filterStar ? reviews.filter(r => r.rating === filterStar) : reviews
  const sorted = [...filtered].sort((a, b) => {
    const aOwn = user && a.user_id === user.id ? 1 : 0
    const bOwn = user && b.user_id === user.id ? 1 : 0
    if (bOwn !== aOwn) return bOwn - aOwn
    const byDate = new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    if (sortBy === 'highest') return b.rating - a.rating || byDate
    if (sortBy === 'lowest') return a.rating - b.rating || byDate
    const aScore = ((a.image_urls?.length ?? 0) > 0 ? 2 : 0) + (a.rating >= 4 ? 1 : 0)
    const bScore = ((b.image_urls?.length ?? 0) > 0 ? 2 : 0) + (b.rating >= 4 ? 1 : 0)
    if (bScore !== aScore) return bScore - aScore
    return byDate
  })
  const visible = sorted.slice(0, visibleCount)
  const hasMore = sorted.length > visibleCount
  const clearFilter = () => {
    setFilterStar(null)
    setVisibleCount(5)
  }

  const write = () => {
    if (!user) {
      showToast('Please login to write a review', 'info')
      router.push('/(auth)/login')
      return
    }
    Linking.openURL(`${SITE_URL}/products/${productSlug}${ownReview ? '?review=edit' : ''}#reviews`)
  }

  return (
    <View ref={sectionRef} collapsable={false} className="mt-10">
      <View className="mb-4 gap-2 bg-surface py-3">
        <View>
          <Text className="mb-0.5 text-xs font-bold uppercase text-accent-500" style={{ letterSpacing: 1.2 }}>
            What buyers say
          </Text>
          <Text className="text-xl font-extrabold text-foreground">Customer Reviews</Text>
        </View>
        <View className="flex-row items-start gap-3">
          {reviews.length > 0 ? (
            <View className="w-36">
              <Pressable
                onPress={() => setSortOpen(o => !o)}
                className="flex-row items-center justify-between rounded-lg border border-border-default bg-surface-elevated px-3 py-2"
              >
                <Text className="text-sm text-foreground">{SORTS.find(s => s.value === sortBy)?.label}</Text>
                <Glyph d={P.chevronDown} size={14} className="text-foreground-muted" />
              </Pressable>
              {sortOpen ? (
                <View className="mt-1 rounded-lg border border-border-default bg-surface-elevated py-1 shadow-lg">
                  {SORTS.map(s => (
                    <Pressable
                      key={s.value}
                      onPress={() => {
                        setSortBy(s.value)
                        setVisibleCount(5)
                        setSortOpen(false)
                      }}
                      className={`px-3 py-2 ${s.value === sortBy ? 'bg-surface-secondary' : ''}`}
                    >
                      <Text className="text-sm text-foreground">{s.label}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}
          {ownReview ? (
            <Pressable onPress={write} className="flex-row items-center gap-2 rounded-lg border border-border-secondary bg-surface-elevated px-4 py-2">
              <Glyph d={P.pencil} size={16} className="text-foreground" />
              <Text className="text-sm font-semibold text-foreground">Edit</Text>
            </Pressable>
          ) : (
            <Pressable onPress={write} className="flex-row items-center gap-2 rounded-lg bg-accent-500 px-4 py-2">
              <Glyph d={P.pencil} size={16} className="text-white" />
              <Text className="text-sm font-semibold text-white">Review</Text>
            </Pressable>
          )}
        </View>
      </View>

      {!isLoading && reviews.length === 0 ? (
        <View className="items-center gap-4 rounded-xl border border-border-default bg-surface-elevated p-8">
          <View className="h-16 w-16 items-center justify-center rounded-full bg-surface-secondary">
            <Glyph d={P.star} size={32} strokeWidth={1.5} className="text-foreground-muted" />
          </View>
          <View className="items-center">
            <Text className="text-base font-semibold text-foreground">No reviews yet</Text>
            <Text className="mt-1 text-center text-sm text-foreground-muted">Be the first to share your experience with this product.</Text>
          </View>
          <EmptyStars size={24} />
        </View>
      ) : (
        <View className="gap-6">
          {isLoading ? (
            <View className="rounded-xl border border-border-default bg-surface-elevated p-4 shadow-sm">
              <View className="mb-4 flex-row items-center gap-3">
                <Skeleton width={72} height={44} />
                <View className="gap-1.5">
                  <Skeleton height={18} width={108} rounded="rounded" />
                  <Skeleton height={10} width={60} rounded="rounded" />
                </View>
              </View>
              <View className="gap-1.5">
                {[1, 2, 3, 4, 5].map(i => (
                  <View key={i} className="h-5 flex-row items-center gap-2 px-1">
                    <Skeleton width={26} height={10} rounded="rounded" />
                    <Skeleton height={6} rounded="rounded-full" className="flex-1" />
                    <Skeleton width={16} height={10} rounded="rounded" />
                  </View>
                ))}
              </View>
            </View>
          ) : approved.length > 0 ? (
            <View className="rounded-xl border border-border-default bg-surface-elevated p-4 shadow-sm">
              <View className="mb-4 flex-row items-center gap-3">
                <Text className="text-5xl font-black text-foreground" style={{ lineHeight: 48 }}>
                  {average.toFixed(1)}
                </Text>
                <View>
                  <StarRow rating={Math.round(average)} />
                  <Text className="mt-1 text-xs text-foreground-muted">
                    {approved.length} {approved.length === 1 ? 'review' : 'reviews'}
                  </Text>
                </View>
              </View>
              <View className="gap-1.5">
                {ratingCounts.map(({ star, count }) => (
                  <RatingBar
                    key={star}
                    star={star}
                    count={count}
                    total={approved.length}
                    isActive={filterStar === star}
                    onPress={() => {
                      setFilterStar(filterStar === star ? null : star)
                      setVisibleCount(5)
                    }}
                  />
                ))}
              </View>
              {filterStar ? (
                <Pressable onPress={clearFilter} className="mt-2 self-start">
                  <Text className="text-xs text-accent-600 dark:text-accent-400">Clear filter</Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <View className="items-center gap-3 rounded-xl border border-border-default bg-surface-elevated p-5 shadow-sm">
              <View className="h-12 w-12 items-center justify-center rounded-full bg-surface-secondary">
                <Glyph d={P.star} size={24} strokeWidth={1.5} className="text-foreground-muted" />
              </View>
              <View className="items-center">
                <Text className="text-sm font-semibold text-foreground">No ratings yet</Text>
                <Text className="mt-0.5 text-xs text-foreground-muted">Be the first to rate</Text>
              </View>
              <EmptyStars size={20} />
            </View>
          )}

          {isLoading ? (
            <View className="gap-4">
              {[1, 2].map(i => (
                <View key={i} className="rounded-xl border border-border-default bg-surface-elevated p-4">
                  <View className="mb-3 flex-row items-center gap-3">
                    <Skeleton width={36} height={36} rounded="rounded-full" />
                    <View className="flex-1 flex-row items-center gap-2">
                      <Skeleton height={13} width={90} />
                      <Skeleton height={14} width={88} rounded="rounded" />
                      <Skeleton height={10} width={64} rounded="rounded" className="ml-auto" />
                    </View>
                  </View>
                  <SkeletonText lines={2} />
                </View>
              ))}
            </View>
          ) : (
            <View className="gap-4">
              {filterStar ? (
                <View className="flex-row flex-wrap items-center justify-between gap-3 rounded-lg bg-accent-50 px-3 py-2 dark:bg-accent-900/20">
                  <Text className="text-xs text-foreground-muted">
                    Showing {sorted.length} {sorted.length === 1 ? 'review' : 'reviews'} with {filterStar} star{filterStar > 1 ? 's' : ''}
                  </Text>
                  <Pressable onPress={clearFilter}>
                    <Text className="text-xs font-medium text-accent-600 dark:text-accent-400">Clear filter</Text>
                  </Pressable>
                </View>
              ) : null}
              {visible.map(review => (
                <View key={review.id} className="rounded-xl border border-border-default bg-surface-elevated p-4">
                  <View className="mb-3 flex-row items-start gap-3">
                    <View className="h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-100 dark:bg-accent-900/40">
                      <Text className="text-sm font-bold text-accent-700 dark:text-accent-300">{initialsOf(review)}</Text>
                    </View>
                    <View className="min-w-0 flex-1 flex-row flex-wrap items-center gap-x-2 gap-y-1">
                      <Text className="text-sm font-semibold text-foreground">{nameOf(review)}</Text>
                      <StarRow rating={review.rating} size={16} />
                      {review.is_approved ? (
                        <View className="flex-row items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 dark:bg-green-900/30">
                          <Glyph d={P.check} size={12} strokeWidth={2.5} className="text-green-700 dark:text-green-400" />
                          <Text className="text-xs font-medium text-green-700 dark:text-green-400">Verified</Text>
                        </View>
                      ) : null}
                      <Text className="ml-auto shrink-0 text-xs text-foreground-muted">
                        {new Date(review.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </Text>
                      {user && review.user_id === user.id ? (
                        <Pressable onPress={write} className="shrink-0 flex-row items-center gap-1">
                          <Glyph d={P.pencil} size={12} className="text-accent-600 dark:text-accent-400" />
                          <Text className="text-xs font-medium text-accent-600 dark:text-accent-400">Edit</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                  {review.title ? <Text className="mb-1 text-sm font-semibold text-foreground">{review.title}</Text> : null}
                  <View className="flex-row items-center gap-3">
                    <View className="min-w-0 flex-1">
                      <Text numberOfLines={2} className="text-sm leading-relaxed text-foreground-secondary">
                        {review.comment}
                      </Text>
                      {review.comment.length > 120 ? (
                        <Pressable onPress={() => setExpanded(review)} className="mt-0.5 self-start">
                          <Text className="text-xs font-medium text-accent-600 dark:text-accent-400">Read more</Text>
                        </Pressable>
                      ) : null}
                    </View>
                    {(review.image_urls?.length ?? 0) > 0 ? (
                      <View className="shrink-0 flex-row gap-1.5">
                        {review.image_urls!.slice(0, 3).map((url, idx) => (
                          <Pressable key={idx} onPress={() => setLightboxUrl(url)} className="h-16 w-16 overflow-hidden rounded-lg border border-border-secondary">
                            <Image source={{ uri: review.image_thumbnail_urls?.[idx] || url }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                  </View>
                </View>
              ))}
              {visible.length === 0 ? (
                <View className="items-center gap-2 rounded-xl border border-border-default bg-surface-elevated py-10">
                  <Text className="text-sm text-foreground-muted">No {filterStar}-star reviews</Text>
                  <Pressable onPress={clearFilter}>
                    <Text className="text-sm text-accent-600 dark:text-accent-400">Clear filter</Text>
                  </Pressable>
                </View>
              ) : null}
              {hasMore ? (
                <Pressable onPress={() => setVisibleCount(c => c + 5)} className="w-full items-center rounded-xl border border-border-secondary py-3">
                  <Text className="text-sm font-semibold text-foreground">Show more reviews ({sorted.length - visibleCount} remaining)</Text>
                </Pressable>
              ) : null}
            </View>
          )}
        </View>
      )}

      <Modal visible={!!expanded} transparent animationType="fade" onRequestClose={() => setExpanded(null)}>
        <View className="flex-1 items-center justify-center p-4">
          <Pressable className="absolute inset-0 bg-black/60" onPress={() => setExpanded(null)} />
          {expanded ? (
            <View className="w-full max-w-lg overflow-hidden rounded-xl border border-border-default bg-surface-elevated shadow-2xl" style={{ maxHeight: '90%' }}>
              <View className="flex-row items-center justify-between border-b border-border-default px-5 py-4">
                <View className="min-w-0 flex-1 flex-row items-center gap-3">
                  <View className="h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-100 dark:bg-accent-900/40">
                    <Text className="text-sm font-bold text-accent-700 dark:text-accent-300">{initialsOf(expanded)}</Text>
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text numberOfLines={1} className="text-sm font-semibold text-foreground">
                      {nameOf(expanded)}
                    </Text>
                    <View className="flex-row items-center gap-2">
                      <StarRow rating={expanded.rating} size={16} />
                      {expanded.is_approved ? <Text className="text-xs font-medium text-green-600 dark:text-green-400">Verified</Text> : null}
                    </View>
                  </View>
                </View>
                <Pressable onPress={() => setExpanded(null)} hitSlop={8} className="ml-3 shrink-0 rounded-lg p-1" accessibilityLabel="Close">
                  <Glyph d={P.close} size={20} className="text-foreground-muted" />
                </Pressable>
              </View>
              <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
                {expanded.title ? <Text className="font-semibold text-foreground">{expanded.title}</Text> : null}
                <Text className="text-sm leading-relaxed text-foreground-secondary">{expanded.comment}</Text>
                {(expanded.image_urls?.length ?? 0) > 0 ? (
                  <View className="flex-row flex-wrap gap-2 pt-1">
                    {expanded.image_urls!.map((url, idx) => (
                      <Pressable
                        key={idx}
                        onPress={() => {
                          setExpanded(null)
                          setLightboxUrl(url)
                        }}
                        className="h-20 w-20 overflow-hidden rounded-lg border border-border-secondary"
                      >
                        <Image source={{ uri: expanded.image_thumbnail_urls?.[idx] || url }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                      </Pressable>
                    ))}
                  </View>
                ) : null}
                <Text className="text-xs text-foreground-muted">
                  {new Date(expanded.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
                </Text>
              </ScrollView>
            </View>
          ) : null}
        </View>
      </Modal>

      <Modal visible={!!lightboxUrl} transparent animationType="fade" onRequestClose={() => setLightboxUrl(null)}>
        <Pressable onPress={() => setLightboxUrl(null)} className="flex-1 items-center justify-center bg-black/80 p-4">
          {lightboxUrl ? <Image source={{ uri: lightboxUrl }} style={{ width: '100%', height: '90%', borderRadius: 8 }} contentFit="contain" /> : null}
          <Pressable
            onPress={() => setLightboxUrl(null)}
            className="absolute right-4 top-12 h-9 w-9 items-center justify-center rounded-full bg-black/60"
            accessibilityLabel="Close"
          >
            <Text className="text-xl text-white" style={{ lineHeight: 22 }}>
              ×
            </Text>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  )
}
