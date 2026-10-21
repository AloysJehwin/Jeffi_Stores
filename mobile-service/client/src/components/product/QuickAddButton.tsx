import { useState } from 'react'
import { Modal, Pressable, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { Minus, Plus, X } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { addToCart } from '../../api/cart'
import { useAuthStore } from '../../stores/authStore'
import { showToast } from '../../stores/toastStore'
import { inr } from '../../lib/format'
import { status, useTokens } from '../../theme'
import type { CardProduct } from '../../types/home'

/** The web's round "+" button: a quantity sheet for simple products, the product page for variants. */
export default function QuickAddButton({ product, inStock }: { product: CardProduct; inStock: boolean }) {
  const router = useRouter()
  const qc = useQueryClient()
  const t = useTokens()
  const insets = useSafeAreaInsets()
  const user = useAuthStore(s => s.user)
  const [open, setOpen] = useState(false)
  const [qty, setQty] = useState(1)
  const [adding, setAdding] = useState(false)

  if (!inStock) {
    return (
      <View className="h-7 w-7 items-center justify-center rounded-full border border-border-default bg-surface-secondary opacity-60">
        <Plus size={14} color={t.foregroundMuted} strokeWidth={2.5} />
      </View>
    )
  }

  const onPress = () => {
    if (product.hasVariants || product.isDigital) return router.push(`/product/${product.slug}`)
    setOpen(true)
  }

  const add = async () => {
    if (!user) {
      setOpen(false)
      return router.push('/(auth)/login')
    }
    setAdding(true)
    try {
      await addToCart({ product_id: product.id, quantity: qty })
      qc.invalidateQueries({ queryKey: ['cart'] })
      showToast(qty === 1 ? 'Added to cart!' : `${qty} added to cart!`, 'success')
      setOpen(false)
      setQty(1)
    } catch (e) {
      showToast(e instanceof Error && e.message ? e.message : 'Could not add to cart', 'error')
    } finally {
      setAdding(false)
    }
  }

  return (
    <>
      <Pressable
        onPress={onPress}
        hitSlop={6}
        accessibilityLabel={product.hasVariants ? `Choose options for ${product.name}` : `Quick add ${product.name} to cart`}
        className="h-7 w-7 items-center justify-center rounded-full bg-accent-500 shadow-sm active:bg-accent-600"
      >
        <Plus size={14} color={status.white} strokeWidth={2.5} />
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable className="flex-1 bg-black/40" onPress={() => setOpen(false)} />
        <View
          className="rounded-t-2xl border-t border-border-default bg-surface-elevated px-5 pt-4"
          style={{ paddingBottom: insets.bottom + 16 }}
        >
          <View className="mb-4 flex-row items-center gap-3">
            {product.primaryImage ? (
              <Image
                source={{ uri: product.primaryImage.thumbnail_url || product.primaryImage.image_url }}
                style={{ width: 56, height: 56, borderRadius: 8 }}
                contentFit="contain"
              />
            ) : null}
            <View className="flex-1">
              <Text className="font-semibold text-foreground" numberOfLines={2}>{product.name}</Text>
              <Text className="mt-0.5 font-bold text-primary-600 dark:text-primary-400">₹{inr(product.displayPrice)}</Text>
            </View>
            <Pressable onPress={() => setOpen(false)} hitSlop={8} accessibilityLabel="Close">
              <X size={20} color={t.foregroundMuted} />
            </Pressable>
          </View>

          <View className="mb-4 flex-row items-center justify-between">
            <Text className="text-sm font-medium text-foreground-secondary">Quantity</Text>
            <View className="flex-row items-center rounded-full border border-border-default">
              <Pressable onPress={() => setQty(q => Math.max(1, q - 1))} className="h-9 w-9 items-center justify-center" accessibilityLabel="Decrease">
                <Minus size={16} color={t.foreground} />
              </Pressable>
              <Text className="w-8 text-center font-semibold text-foreground">{qty}</Text>
              <Pressable onPress={() => setQty(q => Math.min(99, q + 1))} className="h-9 w-9 items-center justify-center" accessibilityLabel="Increase">
                <Plus size={16} color={t.foreground} />
              </Pressable>
            </View>
          </View>

          <Pressable
            onPress={add}
            disabled={adding}
            className="items-center rounded-lg bg-accent-500 py-3.5 active:bg-accent-600 disabled:opacity-60"
          >
            <Text className="font-semibold text-white">{adding ? 'Adding…' : 'Add to Cart'}</Text>
          </Pressable>
        </View>
      </Modal>
    </>
  )
}
