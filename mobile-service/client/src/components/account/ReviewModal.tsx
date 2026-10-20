import { useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { Image } from 'expo-image'
import { generateReview, postForm, type OrderReview } from '../../api/account'
import { useStoreConfig } from '../../hooks/useStoreConfig'
import { absUrl } from '../../lib/links'
import { showToast } from '../../stores/toastStore'
import HeroIcon from './HeroIcon'
import { accent, useTokens } from '../../theme'

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
  const t = useTokens()
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
      onClose()
    } catch (err: any) {
      showToast(err?.message || 'Something went wrong. Please try again.', 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 justify-end">
        <Pressable className="absolute inset-0 bg-black/50" onPress={onClose} />
        <View className="bg-surface-elevated rounded-t-2xl" style={{ maxHeight: '90%' }}>
          <View className="border-b border-border-default px-5 py-4 flex-row items-center justify-between">
            <Text className="text-base font-bold text-foreground">{allAlreadyReviewed ? 'Edit Your Reviews' : 'Rate Your Order'}</Text>
            <Pressable onPress={onClose} className="p-1 rounded-full">
              <HeroIcon name="x" size={20} color={t.foregroundMuted} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 32 }}>
            {items.map((item, i) => {
              const s = states[i]
              const img = absUrl(item.productImage)
              return (
                <View key={item.productId} className={i > 0 ? 'pt-8 border-t border-border-default' : ''}>
                  <View className="flex-row items-center gap-3 mb-4">
                    {img && <Image source={{ uri: img }} style={{ width: 48, height: 48, borderRadius: 8 }} contentFit="cover" />}
                    <Text className="flex-1 text-sm font-semibold text-foreground" numberOfLines={2}>
                      {item.productName}
                    </Text>
                  </View>

                  <View className="mb-4">
                    <Text className="text-sm font-medium text-foreground mb-2">
                      Rating <Text className="text-red-500">*</Text>
                    </Text>
                    <View className="flex-row gap-1">
                      {[1, 2, 3, 4, 5].map(n => (
                        <Pressable key={n} onPress={() => update(i, { rating: n })} hitSlop={4}>
                          <Text className={`text-3xl ${s.rating >= n ? 'text-yellow-400' : 'text-gray-300'}`}>★</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>

                  <View className="mb-4">
                    <Text className="text-sm font-medium text-foreground mb-2">What did you like?</Text>
                    <View className="flex-row flex-wrap gap-2">
                      {TAGS.map(tag => {
                        const on = s.selectedTags.includes(tag)
                        return (
                          <Pressable
                            key={tag}
                            onPress={() => toggleTag(i, tag)}
                            className={`px-3 py-1.5 rounded-full border ${on ? 'bg-accent-500 border-accent-500' : 'bg-surface-secondary border-border-default'}`}
                          >
                            <Text className={`text-xs font-medium ${on ? 'text-white' : 'text-foreground-secondary'}`}>{tag}</Text>
                          </Pressable>
                        )
                      })}
                    </View>
                  </View>

                  {aiEnabled && (
                    <Pressable
                      onPress={() => handleGenerate(i)}
                      disabled={!s.rating || s.isGenerating}
                      className={`w-full flex-row items-center justify-center gap-2 py-2 px-4 rounded-lg border border-accent-400 mb-4 ${!s.rating || s.isGenerating ? 'opacity-40' : ''}`}
                    >
                      {s.isGenerating ? <ActivityIndicator size="small" color={accent[600]} /> : <HeroIcon name="bolt" size={16} color={accent[600]} />}
                      <Text className="text-accent-600 dark:text-accent-400 text-sm font-medium">{s.isGenerating ? 'Generating…' : 'Generate with AI'}</Text>
                    </Pressable>
                  )}

                  <View className="mb-4">
                    <Text className="text-sm font-medium text-foreground mb-1">
                      Title <Text className="text-foreground-muted">(optional)</Text>
                    </Text>
                    <TextInput
                      value={s.title}
                      onChangeText={v => update(i, { title: v })}
                      maxLength={120}
                      placeholder="Summarise your experience"
                      placeholderTextColor={t.foregroundMuted}
                      className="w-full px-3 py-2 rounded-lg border border-border-default bg-surface text-foreground text-sm"
                    />
                  </View>

                  <View className="mb-4">
                    <Text className="text-sm font-medium text-foreground mb-1">
                      Your review <Text className="text-red-500">*</Text>
                    </Text>
                    <TextInput
                      value={s.comment}
                      onChangeText={v => update(i, { comment: v })}
                      maxLength={2000}
                      multiline
                      numberOfLines={3}
                      textAlignVertical="top"
                      placeholder="Tell others about your experience…"
                      placeholderTextColor={t.foregroundMuted}
                      className="w-full px-3 py-2 rounded-lg border border-border-default bg-surface text-foreground text-sm"
                      style={{ minHeight: 76 }}
                    />
                  </View>

                  {s.existingImageUrls.length > 0 && (
                    <View>
                      <Text className="text-sm font-medium text-foreground mb-2">
                        Photos <Text className="text-foreground-muted">(up to 3)</Text>
                      </Text>
                      <View className="flex-row flex-wrap gap-2">
                        {s.existingImageUrls.map((url, j) => (
                          <View key={`ex-${j}`} className="w-14 h-14 rounded-lg overflow-hidden border border-border-default">
                            <Image source={{ uri: absUrl(s.existingThumbUrls[j] || url) ?? undefined }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                            <Pressable
                              onPress={() =>
                                update(i, {
                                  existingImageUrls: s.existingImageUrls.filter((_, idx) => idx !== j),
                                  existingThumbUrls: s.existingThumbUrls.filter((_, idx) => idx !== j),
                                })
                              }
                              className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/60 items-center justify-center"
                            >
                              <Text className="text-white text-xs leading-none">×</Text>
                            </Pressable>
                          </View>
                        ))}
                      </View>
                    </View>
                  )}

                  {!!s.error && <Text className="text-sm text-red-500 mt-2">{s.error}</Text>}
                </View>
              )
            })}

            <View className="flex-row gap-3 pt-1 pb-4">
              <Pressable onPress={onClose} className="flex-1 py-2.5 rounded-lg border border-border-default items-center">
                <Text className="text-sm font-medium text-foreground-secondary">Cancel</Text>
              </Pressable>
              <Pressable onPress={handleSubmitAll} disabled={isSubmitting} className={`flex-1 py-2.5 rounded-lg bg-accent-500 items-center ${isSubmitting ? 'opacity-50' : ''}`}>
                <Text className="text-white text-sm font-semibold">{isSubmitting ? 'Submitting…' : allAlreadyReviewed ? 'Update Reviews' : 'Submit Reviews'}</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}
