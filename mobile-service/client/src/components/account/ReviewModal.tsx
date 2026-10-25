import { useRef, useState } from 'react'
import { Pressable, View, type ScrollView } from 'react-native'
import { Image } from 'expo-image'
import { X, Zap } from 'lucide-react-native'
import { generateReview, postForm, type OrderReview } from '../../api/account'
import { useStoreConfig } from '../../hooks/useStoreConfig'
import { absUrl } from '../../lib/links'
import { showToast } from '../../stores/toastStore'
import { Button, Chip, ChipGroup, cn, Divider, FieldError, IconButton, Label, ModalSheet, Text, TextField } from '../../ui'

// Mirror of controller-service app/(storefront)/account/orders/[id]/ReviewModal.tsx.
// No image picker in the app: existing photos can be kept or removed, new ones can't be added.

const TAGS = ['Great quality', 'Fast delivery', 'Worth the price', 'Exactly as described', 'Well packed', 'Will buy again', 'Highly recommend']

export interface ReviewItem {
  productId: string
  productName: string
  productImage?: string | null
}

interface ItemState {
  rating: number
  selectedTags: string[]
  title: string
  comment: string
  isGenerating: boolean
  existingImageUrls: string[]
  existingThumbUrls: string[]
  error: string
  submitted: boolean
}

const initial = (r: OrderReview | undefined): ItemState => ({
  rating: r?.rating ?? 5,
  selectedTags: r?.tags ?? [],
  title: r?.title ?? '',
  comment: r?.comment ?? '',
  isGenerating: false,
  existingImageUrls: r?.image_urls ?? [],
  existingThumbUrls: r?.image_thumbnail_urls ?? [],
  error: '',
  submitted: false,
})

export default function ReviewModal({
  items,
  reviewMap,
  onClose,
  onSuccess,
}: {
  items: ReviewItem[]
  reviewMap: Record<string, OrderReview>
  onClose: () => void
  onSuccess: (productId: string, review: OrderReview) => void
}) {
  // Mounted while the parent shows it; closing slides the sheet away first, then tells the parent.
  const [open, setOpen] = useState(true)
  const close = () => setOpen(false)
  const [states, setStates] = useState<ItemState[]>(() => items.map(i => initial(reviewMap[i.productId])))
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [aiOff, setAiOff] = useState(false)
  const aiEnabled = !!(useStoreConfig().flags as { aiStorefrontEnabled?: boolean }).aiStorefrontEnabled && !aiOff
  const allAlreadyReviewed = items.every(i => !!reviewMap[i.productId])

  const update = (i: number, patch: Partial<ItemState>) => setStates(prev => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  const toggleTag = (i: number, tag: string) =>
    setStates(prev =>
      prev.map((s, idx) => (idx !== i ? s : { ...s, selectedTags: s.selectedTags.includes(tag) ? s.selectedTags.filter(x => x !== tag) : [...s.selectedTags, tag] }))
    )

  const handleGenerate = async (i: number) => {
    const s = states[i]
    if (!s.rating) return
    update(i, { isGenerating: true })
    try {
      const res = await generateReview({ productName: items[i].productName, rating: s.rating, tags: s.selectedTags })
      if (res.status === 403) return setAiOff(true)
      if (res.data.review) update(i, { comment: res.data.review })
    } catch {
    } finally {
      update(i, { isGenerating: false })
    }
  }

  const handleSubmitAll = async () => {
    const next = states.map(s => {
      if (s.submitted) return s
      if (!s.rating) return { ...s, error: 'Please select a star rating' }
      if (!s.comment.trim()) return { ...s, error: 'Please write a comment' }
      return { ...s, error: '' }
    })
    setStates(next)
    if (next.some(s => !s.submitted && s.error)) return
    setIsSubmitting(true)
    try {
      await Promise.all(
        items.map(async (item, i) => {
          const s = next[i]
          if (s.submitted) return
          const existing = reviewMap[item.productId]
          const fd = new FormData()
          fd.append('productId', item.productId)
          fd.append('rating', String(s.rating))
          if (s.title.trim()) fd.append('title', s.title.trim())
          fd.append('comment', s.comment.trim())
          s.selectedTags.forEach(tag => fd.append('tags[]', tag))
          if (existing) {
            fd.append('reviewId', existing.id)
            fd.append('existingImageUrls', JSON.stringify(s.existingImageUrls))
            fd.append('existingImageThumbUrls', JSON.stringify(s.existingThumbUrls))
          }
          const data = await postForm<{ review: OrderReview }>('/api/reviews', fd, existing ? 'PATCH' : 'POST').catch((e: Error) => {
            throw new Error(e.message || `Failed to submit review for ${item.productName}`)
          })
          onSuccess(item.productId, data.review)
          update(i, { submitted: true })
        })
      )
      close()
    } catch (err: any) {
      showToast(err?.message || 'Something went wrong. Please try again.', 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  // The sheet shrinks above the keyboard; with several items, bring the one being typed in to the top.
  const scrollRef = useRef<ScrollView>(null)
  const itemY = useRef<number[]>([])
  const fieldY = useRef<number[]>([])
  const reveal = (i: number) => {
    if (items.length < 2) return
    setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, (itemY.current[i] ?? 0) + (fieldY.current[i] ?? 0) - 12), animated: true }), 300)
  }

  return (
    <ModalSheet
      open={open}
      onClose={close}
      onClosed={onClose}
      scrollRef={scrollRef}
      title={allAlreadyReviewed ? 'Edit Your Reviews' : 'Rate Your Order'}
      footer={
        <View className="flex-row gap-3">
          <View className="flex-1">
            <Button label="Cancel" variant="secondary" onPress={close} />
          </View>
          <View className="flex-1">
            <Button label={allAlreadyReviewed ? 'Update Reviews' : 'Submit Reviews'} loading={isSubmitting} loadingLabel="Submitting…" onPress={handleSubmitAll} />
          </View>
        </View>
      }
    >
      {items.map((item, i) => {
        const s = states[i]
        const img = absUrl(item.productImage)
        return (
          <View key={item.productId} className={i > 0 ? 'mt-6' : ''} onLayout={e => (itemY.current[i] = e.nativeEvent.layout.y)}>
            {i > 0 ? <Divider className="mb-6" /> : null}
            <View className="mb-4 flex-row items-center gap-3">
              {img && <Image source={{ uri: img }} style={{ width: 48, height: 48, borderRadius: 12 }} contentFit="cover" />}
              <Text className="flex-1 text-[15px] font-semibold text-foreground" numberOfLines={2}>
                {item.productName}
              </Text>
            </View>

            <View className="mb-4">
              <Label required>Rating</Label>
              <View accessibilityRole="radiogroup" className="flex-row gap-1">
                {[1, 2, 3, 4, 5].map(n => (
                  <Pressable
                    key={n}
                    onPress={() => update(i, { rating: n })}
                    hitSlop={4}
                    accessibilityRole="radio"
                    accessibilityLabel={`${n} star${n > 1 ? 's' : ''}`}
                    accessibilityState={{ checked: s.rating === n }}
                    className="h-11 w-11 items-center justify-center"
                  >
                    <Text className={cn('text-[32px] leading-10', s.rating >= n ? 'text-yellow-400' : 'text-border-secondary')}>★</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View className="mb-4">
              <Label>What did you like?</Label>
              <ChipGroup>
                {TAGS.map(tag => (
                  <Chip key={tag} size="sm" label={tag} selected={s.selectedTags.includes(tag)} onPress={() => toggleTag(i, tag)} />
                ))}
              </ChipGroup>
            </View>

            {aiEnabled && (
              <View className="mb-4">
                <Button
                  label="Generate with AI"
                  loadingLabel="Generating…"
                  loading={s.isGenerating}
                  disabled={!s.rating}
                  icon={Zap}
                  variant="outline"
                  size="md"
                  onPress={() => handleGenerate(i)}
                />
              </View>
            )}

            <View className="mb-4" onLayout={e => (fieldY.current[i] = e.nativeEvent.layout.y)}>
              <TextField label="Title (optional)" value={s.title} onChangeText={v => update(i, { title: v })} onFocus={() => reveal(i)} maxLength={120} placeholder="Summarise your experience" />
            </View>

            <TextField
              label="Your review"
              required
              value={s.comment}
              onChangeText={v => update(i, { comment: v })}
              onFocus={() => reveal(i)}
              maxLength={2000}
              multiline
              placeholder="Tell others about your experience…"
            />

            {s.existingImageUrls.length > 0 && (
              <View className="mt-4">
                <Label>Photos (up to 3)</Label>
                <View className="flex-row flex-wrap gap-3">
                  {s.existingImageUrls.map((url, j) => (
                    <View key={`ex-${j}`} className="h-16 w-16 overflow-hidden rounded-xl border border-border-default">
                      <Image source={{ uri: absUrl(s.existingThumbUrls[j] || url) ?? undefined }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                      <IconButton
                        icon={X}
                        label="Remove photo"
                        variant="overlay"
                        size="sm"
                        className="absolute -right-1 -top-1"
                        onPress={() =>
                          update(i, {
                            existingImageUrls: s.existingImageUrls.filter((_, idx) => idx !== j),
                            existingThumbUrls: s.existingThumbUrls.filter((_, idx) => idx !== j),
                          })
                        }
                      />
                    </View>
                  ))}
                </View>
              </View>
            )}

            <FieldError message={s.error} className="mt-2" />
          </View>
        )
      })}
    </ModalSheet>
  )
}
