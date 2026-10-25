import { useState, type RefObject } from 'react'
import { Linking, Pressable, View } from 'react-native'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { Check, Pencil, Star } from 'lucide-react-native'
import { getProductReviews, type PdpReview } from '../../api/pdp'
import { SITE_URL } from '../../lib/links'
import { useAuthStore } from '../../stores/authStore'
import { showToast } from '../../stores/toastStore'
import { primary, useTokens } from '../../theme'
import {
  Badge, Button, Card, EmptyState, Lightbox, ModalSheet, Overline, SelectField, Skeleton, SkeletonText, Text, TextButton, Title,
} from '../../ui'

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

const STAR = primary[400]

export function StarRow({ rating, size = 20 }: { rating: number; size?: number }) {
  const t = useTokens()
  return (
    <View className="flex-row" style={{ gap: 2 }}>
      {[1, 2, 3, 4, 5].map(star =>
        star <= rating ? (
          <Star key={star} size={size} color={STAR} fill={STAR} />
        ) : (
          <Star key={star} size={size} strokeWidth={1.5} color={t.border} />
        )
      )}
    </View>
  )
}

/** pdp/ReviewSummaryLink: compact rating near the title that jumps to the reviews section. */
export function ReviewSummaryLink({ average, total, onPress }: { average: number; total: number; onPress: () => void }) {
  if (total <= 0) return null
  const noun = total === 1 ? 'review' : 'reviews'
  const t = useTokens()
  const fill = Math.min(100, Math.max(0, (average / 5) * 100))
  const row = (colour: string) => (
    <View className="flex-row" style={{ width: 80 }}>
      {[0, 1, 2, 3, 4].map(i => (
        <Star key={i} size={16} color={colour} fill={colour} />
      ))}
    </View>
  )
  return (
    <View className="-mt-2 mb-4">
      <Pressable
        onPress={onPress}
        accessibilityRole="link"
        accessibilityLabel={`Rated ${average.toFixed(1)} out of 5 from ${total} ${noun}. Go to reviews`}
        hitSlop={6}
        className="flex-row items-center gap-2 self-start"
      >
        <View className="relative">
          {row(t.border)}
          <View className="absolute bottom-0 left-0 top-0 overflow-hidden" style={{ width: `${fill}%` }}>
            {row(STAR)}
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
      accessibilityRole="button"
      accessibilityState={{ selected: isActive, disabled: count === 0 }}
      accessibilityLabel={`${star} star, ${count} ${count === 1 ? 'review' : 'reviews'}`}
      className={`w-full flex-row items-center gap-2 rounded-lg px-1.5 py-1 ${isActive ? 'bg-accent-50 dark:bg-accent-900/20' : ''} ${count === 0 ? 'opacity-50' : ''}`}
    >
      <Text className={`w-3 text-right text-xs ${isActive ? 'font-semibold text-accent-600 dark:text-accent-400' : 'text-foreground-muted'}`}>{star}</Text>
      <Star size={14} color={STAR} fill={STAR} />
      <View className="h-1.5 flex-1 overflow-hidden rounded-full bg-border-default">
        <View className="h-full rounded-full bg-primary-400" style={{ width: `${pct}%` }} />
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
        <Star key={s} size={size} color={STAR} fill={STAR} />
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
  const [visibleCount, setVisibleCount] = useState(5)
  const [expanded, setExpanded] = useState<PdpReview | null>(null)
  // The last review stays in the sheet while it slides away.
  const [shown, setShown] = useState<PdpReview | null>(null)
  if (expanded && expanded !== shown) setShown(expanded)
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
    <View ref={sectionRef} collapsable={false} className="mt-8">
      <View className="mb-4 gap-3 bg-surface py-3">
        <View>
          <Overline className="mb-0.5 text-accent-600 dark:text-accent-400">What buyers say</Overline>
          <Title>Customer Reviews</Title>
        </View>
        <View className="flex-row items-start gap-3">
          {reviews.length > 0 ? (
            <SelectField
              value={sortBy}
              options={SORTS}
              onChange={v => {
                setSortBy(v as Sort)
                setVisibleCount(5)
              }}
              sheetTitle="Sort reviews"
              className="flex-1"
            />
          ) : null}
          {ownReview ? (
            <Button label="Edit" icon={Pencil} variant="outline" block={false} onPress={write} />
          ) : (
            <Button label="Review" icon={Pencil} block={false} onPress={write} />
          )}
        </View>
      </View>

      {!isLoading && reviews.length === 0 ? (
        <Card padded={false}>
          <EmptyState icon={Star} title="No reviews yet" message="Be the first to share your experience with this product.">
            <View className="mt-4">
              <EmptyStars size={24} />
            </View>
          </EmptyState>
        </Card>
      ) : (
        <View className="gap-6">
          {isLoading ? (
            <Card>
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
            </Card>
          ) : approved.length > 0 ? (
            <Card>
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
              {filterStar ? <TextButton label="Clear filter" onPress={clearFilter} className="mt-2" /> : null}
            </Card>
          ) : (
            <Card padded={false}>
              <EmptyState icon={Star} title="No ratings yet" message="Be the first to rate" className="py-8">
                <View className="mt-3">
                  <EmptyStars size={20} />
                </View>
              </EmptyState>
            </Card>
          )}

          {isLoading ? (
            <View className="gap-4">
              {[1, 2].map(i => (
                <Card key={i}>
                  <View className="mb-3 flex-row items-center gap-3">
                    <Skeleton width={36} height={36} rounded="rounded-full" />
                    <View className="flex-1 flex-row items-center gap-2">
                      <Skeleton height={13} width={90} />
                      <Skeleton height={14} width={88} rounded="rounded" />
                      <Skeleton height={10} width={64} rounded="rounded" className="ml-auto" />
                    </View>
                  </View>
                  <SkeletonText lines={2} />
                </Card>
              ))}
            </View>
          ) : (
            <View className="gap-4">
              {filterStar ? (
                <View className="flex-row flex-wrap items-center justify-between gap-3 rounded-field bg-accent-50 px-4 py-2 dark:bg-accent-900/20">
                  <Text className="text-xs text-foreground-secondary">
                    Showing {sorted.length} {sorted.length === 1 ? 'review' : 'reviews'} with {filterStar} star{filterStar > 1 ? 's' : ''}
                  </Text>
                  <TextButton label="Clear filter" onPress={clearFilter} />
                </View>
              ) : null}
              {visible.map(review => (
                <Card key={review.id}>
                  <View className="mb-3 flex-row items-start gap-3">
                    <View className="h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-100 dark:bg-accent-900/40">
                      <Text className="text-sm font-bold text-accent-700 dark:text-accent-300">{initialsOf(review)}</Text>
                    </View>
                    <View className="min-w-0 flex-1 flex-row flex-wrap items-center gap-x-2 gap-y-1">
                      <Text className="text-sm font-semibold text-foreground">{nameOf(review)}</Text>
                      <StarRow rating={review.rating} size={16} />
                      {review.is_approved ? <Badge label="Verified" tone="success" icon={Check} size="sm" /> : null}
                      <Text className="ml-auto shrink-0 text-xs text-foreground-muted">
                        {new Date(review.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </Text>
                      {user && review.user_id === user.id ? <TextButton label="Edit" accessibilityLabel="Edit your review" onPress={write} /> : null}
                    </View>
                  </View>
                  {review.title ? <Text className="mb-1 text-sm font-semibold text-foreground">{review.title}</Text> : null}
                  <View className="flex-row items-center gap-3">
                    <View className="min-w-0 flex-1">
                      <Text numberOfLines={2} className="text-sm leading-relaxed text-foreground-secondary">
                        {review.comment}
                      </Text>
                      {review.comment.length > 120 ? <TextButton label="Read more" onPress={() => setExpanded(review)} /> : null}
                    </View>
                    {(review.image_urls?.length ?? 0) > 0 ? (
                      <View className="shrink-0 flex-row gap-1.5">
                        {review.image_urls!.slice(0, 3).map((url, idx) => (
                          <Pressable
                            key={idx}
                            onPress={() => setLightboxUrl(url)}
                            accessibilityRole="imagebutton"
                            accessibilityLabel={`Review photo ${idx + 1}`}
                            className="h-16 w-16 overflow-hidden rounded-xl border border-border-secondary"
                          >
                            <Image source={{ uri: review.image_thumbnail_urls?.[idx] || url }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                  </View>
                </Card>
              ))}
              {visible.length === 0 ? (
                <Card className="items-center gap-2 py-10">
                  <Text className="text-sm text-foreground-muted">No {filterStar}-star reviews</Text>
                  <TextButton label="Clear filter" onPress={clearFilter} className="self-center" />
                </Card>
              ) : null}
              {hasMore ? (
                <Button label={`Show more reviews (${sorted.length - visibleCount} remaining)`} variant="outline" size="md" onPress={() => setVisibleCount(c => c + 5)} />
              ) : null}
            </View>
          )}
        </View>
      )}

      <ModalSheet open={!!expanded} onClose={() => setExpanded(null)} title={shown ? nameOf(shown) || 'Review' : undefined}>
        {shown ? (
          <View className="gap-4">
            <View className="-mt-2 flex-row flex-wrap items-center gap-2">
              <StarRow rating={shown.rating} size={16} />
              {shown.is_approved ? <Badge label="Verified" tone="success" icon={Check} size="sm" /> : null}
            </View>
            {shown.title ? <Text className="text-base font-semibold text-foreground">{shown.title}</Text> : null}
            <Text className="text-[15px] leading-[22px] text-foreground-secondary">{shown.comment}</Text>
            {(shown.image_urls?.length ?? 0) > 0 ? (
              <View className="flex-row flex-wrap gap-2 pt-1">
                {shown.image_urls!.map((url, idx) => (
                  <Pressable
                    key={idx}
                    onPress={() => {
                      setExpanded(null)
                      setLightboxUrl(url)
                    }}
                    accessibilityRole="imagebutton"
                    accessibilityLabel={`Review photo ${idx + 1}`}
                    className="h-20 w-20 overflow-hidden rounded-xl border border-border-secondary"
                  >
                    <Image source={{ uri: shown.image_thumbnail_urls?.[idx] || url }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                  </Pressable>
                ))}
              </View>
            ) : null}
            <Text className="text-xs text-foreground-muted">
              {new Date(shown.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
            </Text>
          </View>
        ) : null}
      </ModalSheet>

      <Lightbox open={!!lightboxUrl} onClose={() => setLightboxUrl(null)}>
        <Pressable onPress={() => setLightboxUrl(null)} accessibilityLabel="Close" className="flex-1 items-center justify-center p-4">
          {lightboxUrl ? <Image source={{ uri: lightboxUrl }} style={{ width: '100%', height: '90%', borderRadius: 16 }} contentFit="contain" /> : null}
        </Pressable>
      </Lightbox>
    </View>
  )
}
