import { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, ShoppingCart } from 'lucide-react-native'
import TopNav from '../../src/components/layout/TopNav'
import {
  Button, Card, CardSegment, EmptyState, Notice, Screen, SectionedList, Skeleton, SummarySkeleton, Text, TextButton, TextField, Title, confirm, segmentAt, toast,
} from '../../src/ui'
import CartLineItem from '../../src/components/cart/CartLineItem'
import SavedItemRow from '../../src/components/cart/SavedItemRow'
import FreeShippingProgress from '../../src/components/cart/FreeShippingProgress'
import CouponNudge from '../../src/components/cart/CouponNudge'
import YourCoupons from '../../src/components/cart/YourCoupons'
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
  type CartLine,
  type CartResponse,
  type CouponResult,
} from '../../src/api/cart'
import { useAuthStore } from '../../src/stores/authStore'
import { useBusiness } from '../../src/components/account/hooks'
import { setQuotePrefill } from '../../src/components/business/quotePrefill'
import { useStoreConfig } from '../../src/hooks/useStoreConfig'
import { openHref } from '../../src/lib/links'
import { status } from '../../src/theme'

type CartSection = { key: 'cart' | 'saved'; data: CartLine[] }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Mirror of controller-service app/(storefront)/cart/page.tsx at the mobile breakpoint.
export default function CartScreen() {
  const router = useRouter()
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const authLoading = useAuthStore(s => s.isLoading)
  const { gstEnabled } = useStoreConfig().flags
  const business = useBusiness()
  // ?coupon=CODE from a win card or a link (or a legacy ?couponId=).
  const params = useLocalSearchParams<{ coupon?: string; couponId?: string }>()
  const urlCode = typeof params.coupon === 'string' ? params.coupon.trim().toUpperCase() : ''
  const urlId = typeof params.couponId === 'string' && UUID.test(params.couponId) ? params.couponId : ''
  const urlKey = urlCode || urlId
  const consumedUrlCoupon = useRef<string | null>(null)

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
      toast.error(e instanceof Error && e.message ? e.message : 'Failed to update quantity')
    } finally {
      await refresh()
      mark(id, false)
    }
  }

  const handleRemove = async (id: string) => {
    const ok = await confirm({
      title: 'Remove from cart?',
      message: 'Are you sure you want to remove this item from your cart?',
      confirmLabel: 'Remove',
      destructive: true,
    })
    if (!ok) return
    try {
      await removeCartItem(id)
      await refresh()
      toast.success('Item removed from cart')
    } catch {
      toast.error('Failed to remove item')
    }
  }

  const handleSave = async (id: string) => {
    try {
      await saveForLater(id)
      await refresh()
      toast.success('Saved for later')
    } catch {
      toast.error('Failed to save')
    }
  }

  const handleMove = async (id: string) => {
    mark(id, true)
    try {
      await moveToCart(id)
      await refresh()
      toast.success('Moved to cart')
    } catch {
      toast.error('Failed to move')
    } finally {
      mark(id, false)
    }
  }

  const total = cartTotal(cartItems, gstEnabled, business.approved ? business.discountFor : undefined)
  const physicalTotal = Math.max(0, total - digitalLinesSubtotal(cartItems, gstEnabled))
  const tax = cartTax(cartItems, gstEnabled)
  const discount = appliedCoupon?.discountAmount ?? 0
  const finalTotal = Math.max(0, total - discount)
  const hasInactiveItems = cartItems.some(i => i.products?.is_active === false)

  const runApply = async (lookup: { code: string } | { couponId: string }) => {
    setCouponLoading(true)
    setCouponError('')
    try {
      const data = await applyCoupon({ ...lookup, subtotal: total })
      setAppliedCoupon(data)
      setCouponCode('')
      toast.success(`Coupon "${data.code}" applied — saving ${money(data.discountAmount)}`)
    } catch (e) {
      setCouponError(e instanceof Error && e.message ? e.message : 'Invalid coupon')
    } finally {
      setCouponLoading(false)
    }
  }

  const handleApplyCoupon = (codeArg?: string) => {
    const code = (codeArg ?? couponCode).trim()
    if (code) void runApply({ code })
  }

  // Apply the link's coupon once there is something to apply it to, then clear the param so it
  // isn't applied again. Signed out or an empty cart keeps it, with a notice.
  useEffect(() => {
    if (!urlKey) {
      consumedUrlCoupon.current = null
      return
    }
    if (consumedUrlCoupon.current === urlKey) return
    if (cartQuery.isLoading || authLoading || !user || cartItems.length === 0) return
    consumedUrlCoupon.current = urlKey
    if (urlCode) setCouponCode(urlCode)
    void runApply(urlCode ? { code: urlCode } : { couponId: urlId })
    router.setParams({ coupon: undefined, couponId: undefined })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlKey, cartQuery.isLoading, authLoading, user, cartItems.length])

  const couponNotice =
    !urlKey || authLoading || (user && cartItems.length > 0) ? null : (
      <Notice tone="info" className="mb-4">
        {user ? (
          `${urlCode ? `Coupon ${urlCode}` : 'Your coupon'} is saved to your account. Add something to your cart and it applies here.`
        ) : (
          <View>
            <Text className="text-sm leading-5 text-accent-800 dark:text-accent-200">
              Sign in to use {urlCode ? `coupon ${urlCode}` : 'your coupon'}. It&apos;s saved to your account.
            </Text>
            <TextButton label="Sign in" onPress={() => router.push('/(auth)/login')} className="mt-1" />
          </View>
        )}
      </Notice>
    )

  // The business cart's "Request Quote for Cart": its lines prefill a new quote.
  const requestCartQuote = () => {
    setQuotePrefill(
      cartItems.map(item => ({
        productId: item.products.id,
        variantId: item.variant?.id,
        subVariantId: item.sub_variant?.id,
        description: [item.products.name, item.variant?.variant_name, item.sub_variant?.sub_variant_name].filter(Boolean).join(' — '),
        quantity: Math.round(Number(item.quantity)) || 1,
        unit: item.cart_item_unit?.display_label ?? item.cart_item_unit?.unit ?? item.buy_unit ?? 'Nos',
      }))
    )
    router.push('/account/quotes/new')
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
      toast.error(e instanceof Error && e.message ? e.message : 'Could not reach the server. Please try again.')
    } finally {
      setProceeding(false)
    }
  }

  if (cartQuery.isLoading || savedQuery.isLoading) return <Screen header={<TopNav />} mode="none" loading skeleton={<CartLoading />} />

  const refreshing = cartQuery.isRefetching && !updating.size
  const onRefresh = () => refresh()

  if (cartCount === 0 && savedItems.length === 0) {
    return (
      <Screen header={<TopNav />} refreshing={refreshing} onRefresh={onRefresh}>
        {couponNotice}
        <EmptyState
          fill
          icon={ShoppingCart}
          title="Your cart is empty"
          message="Start shopping to add items to your cart"
          actionLabel="Browse Products"
          onAction={() => openHref(router, '/products')}
        />
      </Screen>
    )
  }

  const sections: CartSection[] = [
    ...(cartItems.length > 0 ? [{ key: 'cart' as const, data: cartItems }] : []),
    ...(savedItems.length > 0 ? [{ key: 'saved' as const, data: savedItems }] : []),
  ]

  // Lines and saved items are rows of a list (one card each, sliced per row), so long carts stay light.
  return (
    <Screen header={<TopNav />} mode="none">
      <SectionedList
        sections={sections}
        keyExtractor={item => item.id}
        extraData={updating}
        keyboard
        refreshing={refreshing}
        onRefresh={onRefresh}
        showsVerticalScrollIndicator={false}
        renderSectionHeader={({ section }) =>
          section.key === 'saved' ? (
            <View className="mt-6">
              <CardSegment position="top">
                <View className="border-b border-border-default p-4">
                  <Text accessibilityRole="header" className="font-display text-base font-extrabold text-foreground">
                    Saved for later <Text className="font-inter font-normal text-foreground-muted">({savedItems.length})</Text>
                  </Text>
                </View>
              </CardSegment>
            </View>
          ) : null
        }
        renderItem={({ item, index, section }) => {
          const n = section.data.length
          return section.key === 'cart' ? (
            <CardSegment position={segmentAt(index, n)}>
              <CartLineItem
                item={item}
                last={index === n - 1}
                updating={updating.has(item.id)}
                businessPct={business.discountFor(item.products.category_id)}
                onQuantity={q => handleQuantity(item.id, q)}
                onSave={() => handleSave(item.id)}
                onRemove={() => handleRemove(item.id)}
              />
            </CardSegment>
          ) : (
            <CardSegment position={segmentAt(index, n, { header: true })}>
              <SavedItemRow
                item={item}
                last={index === n - 1}
                updating={updating.has(item.id)}
                onMove={() => handleMove(item.id)}
                onRemove={() => handleRemove(item.id)}
              />
            </CardSegment>
          )
        }}
        ListHeaderComponent={
          <>
            <Title className="mb-4">Shopping Cart</Title>
            {couponNotice}
            <FreeShippingProgress subtotal={physicalTotal} />
            {cartItems.length === 0 ? (
              <Card padded={false}>
                <EmptyState icon={ShoppingCart} title="Your cart is empty.">
                  <Text className="mt-1.5 text-center text-sm text-foreground-muted">
                    Move an item from below or{' '}
                    <Text accessibilityRole="link" className="font-semibold text-accent-600 dark:text-accent-400" onPress={() => openHref(router, '/products')}>
                      browse products
                    </Text>
                    .
                  </Text>
                </EmptyState>
              </Card>
            ) : null}
          </>
        }
        ListFooterComponent={
          <>
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
            {cartItems.length > 0 && (
              <Card className="mt-4">
                <Text accessibilityRole="header" className="mb-5 font-display text-xl font-extrabold text-foreground">
                  Order Summary
                </Text>

                <View className="mb-5">
                  {appliedCoupon ? (
                    <Notice tone="success">
                      <View className="flex-row items-center justify-between">
                        <View className="flex-1">
                          <Text className="text-sm font-semibold text-green-700 dark:text-green-400">{appliedCoupon.code} applied</Text>
                          {appliedCoupon.description ? (
                            <Text className="text-xs text-green-600 dark:text-green-500">{appliedCoupon.description}</Text>
                          ) : null}
                        </View>
                        <TextButton
                          label="Remove"
                          tone="danger"
                          accessibilityLabel={`Remove coupon ${appliedCoupon.code}`}
                          onPress={() => {
                            setAppliedCoupon(null)
                            setCouponError('')
                          }}
                          className="ml-3 self-center"
                        />
                      </View>
                    </Notice>
                  ) : (
                    <View>
                      <View className="flex-row items-start gap-2">
                        <TextField
                          value={couponCode}
                          onChangeText={v => {
                            setCouponCode(v.toUpperCase())
                            setCouponError('')
                          }}
                          onSubmitEditing={() => handleApplyCoupon()}
                          placeholder="Coupon code"
                          accessibilityLabel="Coupon code"
                          autoCapitalize="characters"
                          autoCorrect={false}
                          returnKeyType="done"
                          error={couponError || null}
                          containerClassName="flex-1"
                        />
                        <Button
                          label="Apply"
                          block={false}
                          loading={couponLoading}
                          disabled={!couponCode.trim()}
                          onPress={() => handleApplyCoupon()}
                        />
                      </View>
                      <CouponNudge subtotal={total} signedIn={!!user} applying={couponLoading} onApply={handleApplyCoupon} />
                      {user ? <YourCoupons userId={user.id} subtotal={total} applying={couponLoading} onApply={handleApplyCoupon} /> : null}
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
                  <Button
                    label={hasInactiveItems ? 'Remove unavailable items to checkout' : 'Proceed to Checkout'}
                    loading={proceeding}
                    loadingLabel="Starting…"
                    disabled={cartCount === 0 || hasInactiveItems}
                    size={hasInactiveItems ? 'md' : 'lg'}
                    haptics
                    onPress={proceedToCheckout}
                    trailing={hasInactiveItems || proceeding ? null : <ChevronRight size={20} color={status.white} strokeWidth={2.2} />}
                  />
                ) : (
                  <View className="gap-3">
                    <Button
                      label="Login to Checkout"
                      onPress={() => router.push('/(auth)/login')}
                      trailing={<ChevronRight size={20} color={status.white} strokeWidth={2.2} />}
                    />
                    <Text className="text-center text-sm text-foreground-secondary">
                      New customer?{' '}
                      <Text accessibilityRole="link" className="font-medium text-accent-600 dark:text-accent-400" onPress={() => router.push('/(auth)/signup')}>
                        Create an account
                      </Text>
                    </Text>
                  </View>
                )}

                {business.approved ? (
                  <Button label="Request a quote for this cart" variant="outline" size="md" onPress={requestCartQuote} className="mt-3" />
                ) : null}
                <Button label="Continue Shopping" variant="ghost" size="md" onPress={() => openHref(router, '/products')} className="mt-2" />
              </Card>
            )}
          </>
        }
      />
    </Screen>
  )
}

/** The loaded cart's shape: title, one card of line rows (96px thumb, price, stepper, subtotal), summary. */
function CartLoading() {
  return (
    <View className="flex-1 overflow-hidden px-4 pt-4">
      <Skeleton height={32} width={210} className="mb-4" />
      <View className="overflow-hidden rounded-panel bg-surface-elevated dark:border dark:border-border-default">
        {[0, 1, 2].map(i => (
          <View key={i} className={`flex-row gap-4 p-4 ${i < 2 ? 'border-b border-border-default' : ''}`}>
            <Skeleton width={96} height={96} rounded="rounded-xl" />
            <View className="flex-1 gap-2">
              <Skeleton height={15} />
              <Skeleton height={15} width="60%" />
              <Skeleton height={20} width={90} className="mt-1" />
              <View className="mt-2 flex-row items-center gap-3">
                <Skeleton height={44} width={128} rounded="rounded-full" />
                <Skeleton height={12} width={80} rounded="rounded" />
              </View>
              <Skeleton height={18} width={130} className="mt-2" />
            </View>
          </View>
        ))}
      </View>
      <SummarySkeleton rows={2} className="mt-4" />
    </View>
  )
}
