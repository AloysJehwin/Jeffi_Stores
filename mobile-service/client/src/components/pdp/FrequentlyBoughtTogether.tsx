import { Fragment, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native'
import { Text } from '../../ui'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Glyph, P } from './Glyph'
import { canAddDirectly, purchasableNow, sumPrices } from './pdp'
import { addPdpToCart, getAffinity } from '../../api/pdp'
import { inr } from '../../lib/format'
import { useAuthStore } from '../../stores/authStore'
import { showToast } from '../../stores/toastStore'
import { status } from '../../theme'
import type { CardProduct } from '../../types/home'

// Mirror of controller-service components/visitor/pdp/FrequentlyBoughtTogether.tsx at the mobile breakpoint.

function Thumb({ product, dimmed }: { product: CardProduct; dimmed: boolean }) {
  const img = product.primaryImage
  return (
    <View className={`h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-border-default bg-surface ${dimmed ? 'opacity-40' : ''}`}>
      {img?.image_url ? (
        <Image
          source={{ uri: img.thumbnail_url || img.image_url }}
          placeholder={img.blurhash ? { blurhash: img.blurhash } : undefined}
          style={{ flex: 1, margin: 4 }}
          contentFit="contain"
        />
      ) : (
        <View className="h-full w-full items-center justify-center">
          <Glyph d={P.photo} size={24} strokeWidth={1} className="text-foreground-muted" />
        </View>
      )}
    </View>
  )
}

function Checkbox({ checked, onPress, label }: { checked: boolean; onPress: () => void; label: string }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      className={`mt-0.5 h-4 w-4 shrink-0 items-center justify-center rounded-sm border ${checked ? 'border-primary-600 bg-primary-600' : 'border-border-secondary bg-surface-elevated'}`}
    >
      {checked ? <Glyph d={P.check} size={12} strokeWidth={3} className="text-white" /> : null}
    </Pressable>
  )
}

export default function FrequentlyBoughtTogether({
  current,
  launchDate,
  discontinueDate,
  gstEnabled,
  onChooseOptions,
}: {
  current: CardProduct
  launchDate?: string | null
  discontinueDate?: string | null
  gstEnabled: boolean
  onChooseOptions: () => void
}) {
  const router = useRouter()
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const { data: others = [] } = useQuery({ queryKey: ['pdp-affinity', 'bought', current.id], queryFn: () => getAffinity('bought', current.id, 3) })
  const [unchecked, setUnchecked] = useState<Set<string>>(() => new Set())
  const [adding, setAdding] = useState(false)

  if (others.length === 0) return null

  const currentAddable = canAddDirectly(current) && purchasableNow(launchDate, discontinueDate)
  const isAddable = (p: CardProduct) => (p.id === current.id ? currentAddable : canAddDirectly(p))
  const items = [current, ...others]
  const picked = items.filter(p => isAddable(p) && !unchecked.has(p.id))
  const total = sumPrices(picked)
  const showBuyBox = others.some(canAddDirectly)

  const toggle = (id: string) =>
    setUnchecked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const addSelected = async () => {
    if (picked.length === 0) return
    if (!user) return router.push('/(auth)/login')
    setAdding(true)
    let added = 0
    let failure: string | null = null
    for (const p of picked) {
      try {
        await addPdpToCart({ productId: p.id, quantity: 1 })
        added++
      } catch (err) {
        failure ??= `${p.name}: ${err instanceof Error && err.message ? err.message : 'could not be added'}`
      }
    }
    setAdding(false)
    qc.invalidateQueries({ queryKey: ['cart'] })
    if (!failure) showToast(added === 1 ? 'Item added to cart!' : `${added} items added to cart!`, 'success')
    else showToast(added > 0 ? `Added ${added} of ${picked.length} items. ${failure}` : failure, 'error')
  }

  const open = (slug: string) => router.push(`/product/${slug}`)

  return (
    <View className="mb-4 rounded-lg border border-border-default bg-surface-elevated p-4 shadow-sm">
      <Text className="mb-4 text-lg font-bold text-foreground">Frequently bought together</Text>
      <View className="gap-5">
        <View className="min-w-0">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-4" contentContainerStyle={{ alignItems: 'center', gap: 8, paddingBottom: 4 }}>
            {items.map((p, i) => (
              <Fragment key={p.id}>
                {i > 0 ? <Text className="shrink-0 text-lg font-semibold text-foreground-muted">+</Text> : null}
                {p.id === current.id ? (
                  <Thumb product={p} dimmed={isAddable(p) && unchecked.has(p.id)} />
                ) : (
                  <Pressable onPress={() => open(p.slug)} className="shrink-0">
                    <Thumb product={p} dimmed={isAddable(p) && unchecked.has(p.id)} />
                  </Pressable>
                )}
              </Fragment>
            ))}
          </ScrollView>

          <View className="gap-2.5">
            {items.map(p => {
              const isCurrent = p.id === current.id
              const addable = isAddable(p)
              return (
                <View key={p.id} className="flex-row items-start gap-3">
                  {addable ? (
                    <Checkbox checked={!unchecked.has(p.id)} onPress={() => toggle(p.id)} label={`Include ${p.name}`} />
                  ) : (
                    <View className="w-4 shrink-0" />
                  )}
                  <View className="min-w-0 flex-1">
                    {isCurrent ? (
                      <Text className="text-sm leading-snug text-foreground">
                        <Text className="font-semibold">This item: </Text>
                        {p.name}
                      </Text>
                    ) : (
                      <Text onPress={() => open(p.slug)} className="text-sm leading-snug text-foreground">
                        {p.name}
                      </Text>
                    )}
                    <View className="mt-0.5 flex-row flex-wrap items-baseline gap-x-2">
                      <Text className="text-sm font-semibold text-foreground">
                        {p.hasVariants ? 'From ' : ''}₹{inr(p.displayPrice)}
                      </Text>
                      {p.mrp != null && p.mrp > p.displayPrice ? (
                        <Text className="text-xs text-foreground-muted line-through">₹{inr(p.mrp)}</Text>
                      ) : null}
                      {p.hasVariants ? (
                        <Text onPress={() => (isCurrent ? onChooseOptions() : open(p.slug))} className="text-xs font-semibold text-accent-600 dark:text-accent-400">
                          {isCurrent ? 'Choose options above' : 'Choose options'}
                        </Text>
                      ) : Number(p.effectiveStock) <= 0 ? (
                        <Text className="text-xs font-medium text-red-600 dark:text-red-400">Out of stock</Text>
                      ) : !addable ? (
                        <Text className="text-xs font-medium text-foreground-muted">Currently unavailable</Text>
                      ) : null}
                    </View>
                  </View>
                </View>
              )
            })}
          </View>
        </View>

        {showBuyBox ? (
          <View className="rounded-lg border border-border-default bg-surface p-4">
            <Text className="text-sm text-foreground-secondary">
              Total for {picked.length} {picked.length === 1 ? 'item' : 'items'}
            </Text>
            <Text className="text-2xl font-bold text-primary-600 dark:text-primary-400">₹{inr(total)}</Text>
            {gstEnabled ? <Text className="text-[11px] text-foreground-muted">Inclusive of all taxes</Text> : null}
            <Pressable
              onPress={addSelected}
              disabled={adding || picked.length === 0}
              className={`mt-3 w-full flex-row items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 ${adding || picked.length === 0 ? 'opacity-50' : ''}`}
            >
              {adding ? <ActivityIndicator size="small" color={status.white} /> : null}
              <Text className="text-sm font-semibold text-white">{adding ? 'Adding...' : 'Add selected to cart'}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  )
}
