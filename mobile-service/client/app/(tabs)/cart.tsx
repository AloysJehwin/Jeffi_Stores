import { useState } from 'react'
import { Alert, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, ShoppingCart } from 'lucide-react-native'
import TopNav from '../../src/components/layout/TopNav'
import Pulse from '../../src/components/cart/Pulse'
import CartLineItem from '../../src/components/cart/CartLineItem'
import SavedItemRow from '../../src/components/cart/SavedItemRow'
import FreeShippingProgress from '../../src/components/cart/FreeShippingProgress'
import CouponNudge from '../../src/components/cart/CouponNudge'
import AiInsight from '../../src/components/cart/AiInsight'
import CartUpsellRow from '../../src/components/cart/CartUpsellRow'
import FeaturedForYouCompact from '../../src/components/cart/FeaturedForYouCompact'
import { cartTax, cartTotal, digitalLinesSubtotal, money } from '../../src/components/cart/lines'
import {
  applyCoupon,
  createCartIntent,
  getCart,
  getSavedCart,
  moveToCart,
  removeCartItem,
  saveForLater,
  updateCartItem,
  type CartResponse,
  type CouponResult,
} from '../../src/api/cart'
import { useAuthStore } from '../../src/stores/authStore'
import { useStoreConfig } from '../../src/hooks/useStoreConfig'
import { showToast } from '../../src/stores/toastStore'
import { openHref } from '../../src/lib/links'
import { status, useTokens } from '../../src/theme'

// Mirror of controller-service app/(storefront)/cart/page.tsx at the mobile breakpoint.
export default function CartScreen() {
  const router = useRouter()
  const qc = useQueryClient()
  const t = useTokens()
  const user = useAuthStore(s => s.user)
  const { gstEnabled } = useStoreConfig().flags

  const cartQuery = useQuery({ queryKey: ['cart'], queryFn: getCart })
  const savedQuery = useQuery({ queryKey: ['saved-cart'], queryFn: getSavedCart })
  const cartItems = cartQuery.data?.items ?? []
  const savedItems = savedQuery.data?.items ?? []
  const cartCount = cartItems.length

  const [updating, setUpdating] = useState<Set<string>>(new Set())
  const [couponCode, setCouponCode] = useState('')
  const [appliedCoupon, setAppliedCoupon] = useState<CouponResult | null>(null)
  const [couponLoading, setCouponLoading] = useState(false)
  const [couponError, setCouponError] = useState('')
  const [proceeding, setProceeding] = useState(false)

  const mark = (id: string, on: boolean) =>
    setUpdating(prev => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['cart'] }), qc.invalidateQueries({ queryKey: ['saved-cart'] })])

  const handleQuantity = async (id: string, qty: number) => {
    if (qty < 1) return
    mark(id, true)
    // Optimistic, like CartContext.updateQuantity.
    qc.setQueryData<CartResponse>(['cart'], old =>
      old ? { items: old.items.map(i => (i.id === id ? { ...i, quantity: qty } : i)) } : old
    )
    try {
      await updateCartItem(id, qty)
    } catch (e) {
      showToast(e instanceof Error && e.message ? e.message : 'Failed to update quantity', 'error')
    } finally {
      await refresh()
      mark(id, false)
    }
  }

  const handleRemove = (id: string) =>
    Alert.alert('Remove from Cart', 'Are you sure you want to remove this item from your cart?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await removeCartItem(id)
            await refresh()
            showToast('Item removed from cart', 'success')
          } catch {
            showToast('Failed to remove item', 'error')
          }
        },
      },
    ])

  const handleSave = async (id: string) => {
    try {
      await saveForLater(id)
      await refresh()
      showToast('Saved for later', 'success')
    } catch {
      showToast('Failed to save', 'error')
    }
  }

  const handleMove = async (id: string) => {
    mark(id, true)
    try {
      await moveToCart(id)
      await refresh()
      showToast('Moved to cart', 'success')
    } catch {
      showToast('Failed to move', 'error')
    } finally {
      mark(id, false)
    }
  }

  const total = cartTotal(cartItems, gstEnabled)
  const physicalTotal = Math.max(0, total - digitalLinesSubtotal(cartItems, gstEnabled))
  const tax = cartTax(cartItems, gstEnabled)
  const discount = appliedCoupon?.discountAmount ?? 0
  const finalTotal = Math.max(0, total - discount)
  const hasInactiveItems = cartItems.some(i => i.products?.is_active === false)

  const handleApplyCoupon = async (codeArg?: string) => {
    const code = (codeArg ?? couponCode).trim()
    if (!code) return
    setCouponLoading(true)
    setCouponError('')
    try {
      const data = await applyCoupon({ code, subtotal: total })
      setAppliedCoupon(data)
      setCouponCode('')
      showToast(`Coupon "${data.code}" applied — saving ${money(data.discountAmount)}`, 'success')
    } catch (e) {
      setCouponError(e instanceof Error && e.message ? e.message : 'Invalid coupon')
    } finally {
      setCouponLoading(false)
    }
  }

  const proceedToCheckout = async () => {
    setProceeding(true)
    try {
      const intent = await createCartIntent()
      router.push({
        pathname: '/checkout/review',
        params: appliedCoupon ? { intent, couponCode: appliedCoupon.code } : { intent },
      })
    } catch (e) {
      showToast(e instanceof Error && e.message ? e.message : 'Could not reach the server. Please try again.', 'error')
    } finally {
      setProceeding(false)
    }
  }

  if (cartQuery.isLoading || savedQuery.isLoading) {
    return (
      <View className="flex-1 bg-surface">
        <TopNav />
        <View className="gap-4 px-4 py-6">
          {[0, 1, 2].map(i => (
            <Pulse key={i} delay={i * 80}>
              <View className="flex-row gap-4 rounded-lg border border-border-default bg-surface-elevated p-4">
                <View className="h-20 w-20 rounded-lg bg-surface-secondary" />
                <View className="flex-1 gap-2">
                  <View className="h-4 w-3/4 rounded bg-surface-secondary" />
                  <View className="h-3 w-1/2 rounded bg-surface-secondary" />
                  <View className="h-4 w-24 rounded bg-surface-secondary" />
                </View>
              </View>
            </Pulse>
          ))}
        </View>
      </View>
    )
  }

  const refreshControl = (
    <RefreshControl refreshing={cartQuery.isRefetching && !updating.size} onRefresh={() => refresh()} />
  )

  if (cartCount === 0 && savedItems.length === 0) {
    return (
      <View className="flex-1 bg-surface">
        <TopNav />
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 64 }} refreshControl={refreshControl}>
          <View className="items-center">
            <View className="mb-6">
              <ShoppingCart size={96} color={t.foregroundMuted} strokeWidth={1} />
            </View>
            <Text className="mb-2 self-stretch text-center text-2xl font-bold text-foreground">Your cart is empty</Text>
            <Text className="mb-6 self-stretch text-center text-foreground-secondary">Start shopping to add items to your cart</Text>
            <Pressable onPress={() => openHref(router, '/products')} className="rounded-lg bg-accent-500 px-8 py-3 active:bg-accent-600">
              <Text className="font-semibold text-white">Browse Products</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    )
  }

  return (
    <View className="flex-1 bg-surface">
      <TopNav />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 32 }}
        refreshControl={refreshControl}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        showsVerticalScrollIndicator={false}
      >
        <Text className="mb-4 text-3xl font-bold text-foreground">Shopping Cart</Text>

        <View className="gap-4">
          <View>
            <FreeShippingProgress subtotal={physicalTotal} />
            {cartItems.length === 0 ? (
              <View className="items-center rounded-lg border border-border-default bg-surface-elevated p-8 shadow-sm">
                <View className="mb-4">
                  <ShoppingCart size={64} color={t.foregroundMuted} strokeWidth={1} />
                </View>
                <Text className="mb-4 text-foreground-secondary">Your cart is empty.</Text>
                <Text className="text-center text-sm text-foreground-muted">
                  Move an item from below or{' '}
                  <Text className="font-medium text-accent-600" onPress={() => openHref(router, '/products')}>
                    browse products
                  </Text>
                  .
                </Text>
              </View>
            ) : (
              <View className="rounded-lg border border-border-default bg-surface-elevated shadow-sm">
                {cartItems.map((item, i) => (
                  <CartLineItem
                    key={item.id}
                    item={item}
                    last={i === cartItems.length - 1}
                    updating={updating.has(item.id)}
                    onQuantity={q => handleQuantity(item.id, q)}
                    onSave={() => handleSave(item.id)}
                    onRemove={() => handleRemove(item.id)}
                  />
                ))}
              </View>
            )}

            {savedItems.length > 0 && (
              <View className="mt-6 rounded-lg border border-border-default bg-surface-elevated shadow-sm">
                <View className="border-b border-border-default p-4">
                  <Text className="font-semibold text-foreground">
                    Saved for later <Text className="font-normal text-foreground-muted">({savedItems.length})</Text>
                  </Text>
                </View>
                {savedItems.map((item, i) => (
                  <SavedItemRow
                    key={item.id}
                    item={item}
                    last={i === savedItems.length - 1}
                    updating={updating.has(item.id)}
                    onMove={() => handleMove(item.id)}
                    onRemove={() => handleRemove(item.id)}
                  />
                ))}
              </View>
            )}

            {cartItems.length > 0 && (
              <AiInsight
                kind="cart"
                className="mb-4 mt-4"
                body={{
                  cart: cartItems.map(i => ({
                    name: i.products?.name || '',
                    brand: i.products?.brand_name || null,
                    category: null,
                    qty: Number(i.quantity),
                  })),
                }}
              />
            )}

            <CartUpsellRow cartProductIds={cartItems.map(i => i.product_id)} savedProductIds={savedItems.map(i => i.product_id)} />

            <FeaturedForYouCompact limit={4} />
          </View>

          {cartItems.length > 0 && (
            <View className="rounded-lg border border-border-default bg-surface-elevated p-4 shadow-sm">
              <Text className="mb-6 text-xl font-bold text-foreground">Order Summary</Text>

              <View className="mb-5">
                {appliedCoupon ? (
                  <View className="flex-row items-center justify-between rounded-lg border border-green-200 bg-green-50 px-3 py-2 dark:border-green-800 dark:bg-green-900/20">
                    <View className="flex-1">
                      <Text className="text-sm font-semibold text-green-700 dark:text-green-400">{appliedCoupon.code} applied</Text>
                      {appliedCoupon.description ? (
                        <Text className="text-xs text-green-600 dark:text-green-500">{appliedCoupon.description}</Text>
                      ) : null}
                    </View>
                    <Pressable
                      onPress={() => {
                        setAppliedCoupon(null)
                        setCouponError('')
                      }}
                      className="ml-3"
                    >
                      <Text className="text-xs font-medium text-red-500">Remove</Text>
                    </Pressable>
                  </View>
                ) : (
                  <View>
                    <View className="flex-row gap-2">
                      <TextInput
                        value={couponCode}
                        onChangeText={v => {
                          setCouponCode(v.toUpperCase())
                          setCouponError('')
                        }}
                        onSubmitEditing={() => handleApplyCoupon()}
                        placeholder="Coupon code"
                        placeholderTextColor={t.foregroundMuted}
                        autoCapitalize="characters"
                        autoCorrect={false}
                        returnKeyType="done"
                        className="flex-1 rounded-lg border border-border-secondary bg-surface px-3 py-2 text-sm text-foreground"
                      />
                      <Pressable
                        onPress={() => handleApplyCoupon()}
                        disabled={couponLoading || !couponCode.trim()}
                        className="justify-center rounded-lg bg-accent-500 px-4 py-2 active:bg-accent-600 disabled:opacity-50"
                      >
                        <Text className="text-sm font-semibold text-white">{couponLoading ? '...' : 'Apply'}</Text>
                      </Pressable>
                    </View>
                    {couponError ? <Text className="mt-1 text-xs text-red-500">{couponError}</Text> : null}
                    <CouponNudge subtotal={total} signedIn={!!user} applying={couponLoading} onApply={handleApplyCoupon} />
                  </View>
                )}
              </View>

              <View className="mb-6 gap-3">
                <View className="flex-row justify-between">
                  <Text className="text-foreground-secondary">Subtotal ({cartCount} items)</Text>
                  <Text className="text-foreground-secondary">{money(total)}</Text>
                </View>
                {gstEnabled && (
                  <View className="flex-row justify-between">
                    <Text className="text-sm text-foreground-muted">Incl. GST</Text>
                    <Text className="text-sm text-foreground-muted">{money(tax)}</Text>
                  </View>
                )}
                {discount > 0 && (
                  <View className="flex-row justify-between">
                    <Text className="text-sm font-medium text-green-600 dark:text-green-400">Coupon ({appliedCoupon!.code})</Text>
                    <Text className="text-sm font-medium text-green-600 dark:text-green-400">-{money(discount)}</Text>
                  </View>
                )}
                <View className="border-t border-border-default pt-3">
                  <View className="flex-row justify-between">
                    <Text className="text-lg font-bold text-foreground">Total</Text>
                    <Text className="text-lg font-bold text-foreground">{money(finalTotal)}</Text>
                  </View>
                  {discount > 0 && (
                    <Text className="mt-1 text-xs text-green-600 dark:text-green-400">You save {money(discount)} with this coupon</Text>
                  )}
                  {gstEnabled && <Text className="mt-1 text-xs text-foreground-muted">Price inclusive of all taxes</Text>}
                </View>
              </View>

              {user ? (
                <Pressable
                  onPress={proceedToCheckout}
                  disabled={proceeding || cartCount === 0 || hasInactiveItems}
                  className="w-full flex-row items-center justify-center rounded-lg bg-accent-500 px-6 py-3 active:bg-accent-600 disabled:opacity-60"
                >
                  <Text className="font-semibold text-white">
                    {proceeding ? 'Starting…' : hasInactiveItems ? 'Remove unavailable items to checkout' : 'Proceed to Checkout'}
                  </Text>
                  <View className="ml-2">
                    <ChevronRight size={20} color={status.white} strokeWidth={2} />
                  </View>
                </Pressable>
              ) : (
                <View className="gap-3">
                  <Pressable
                    onPress={() => router.push('/(auth)/login')}
                    className="w-full flex-row items-center justify-center rounded-lg bg-accent-500 px-6 py-3 active:bg-accent-600"
                  >
                    <Text className="font-semibold text-white">Login to Checkout</Text>
                    <View className="ml-2">
                      <ChevronRight size={20} color={status.white} strokeWidth={2} />
                    </View>
                  </Pressable>
                  <Text className="text-center text-sm text-foreground-secondary">
                    New customer?{' '}
                    <Text className="font-medium text-accent-600 dark:text-accent-400" onPress={() => router.push('/(auth)/signup')}>
                      Create an account
                    </Text>
                  </Text>
                </View>
              )}

              <Pressable onPress={() => openHref(router, '/products')} className="mt-4">
                <Text className="text-center font-medium text-accent-600 dark:text-accent-400">Continue Shopping</Text>
              </Pressable>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  )
}
