import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Banknote, Check, Copy, MapPin, ShieldCheck, Truck } from 'lucide-react-native'
import { Screen, ScreenHeader, Skeleton, SummarySkeleton, Text } from '../../src/ui'
import AiInsight from '../../src/components/cart/AiInsight'
import AddressFormModal from '../../src/components/checkout/AddressFormModal'
import CouponHintBanner from '../../src/components/checkout/CouponHintBanner'
import Radio from '../../src/components/checkout/Radio'
import { BuyNowReviewRow, CartReviewRow } from '../../src/components/checkout/CheckoutItemRow'
import { useCheckoutStore, type PayMethod } from '../../src/components/checkout/checkoutStore'
import { cartTax, cartTotal, digitalLinesSubtotal, isDigitalLine, money } from '../../src/components/cart/lines'
import {
  applyCoupon,
  getCart,
  getCheckoutIntent,
  getPrimaryImage,
  getStoreSettings,
  type BuyNowIntent,
  type CouponResult,
} from '../../src/api/cart'
import { listAddresses } from '../../src/api/addresses'
import { cancelOrder } from '../../src/api/orders'
import { api } from '../../src/api/client'
import { useAuthStore } from '../../src/stores/authStore'
import { useStoreConfig } from '../../src/hooks/useStoreConfig'
import { invalidateEddCache } from '../../src/lib/edd'
import { showToast } from '../../src/stores/toastStore'
import { trackBeginCheckout } from '../../src/lib/analytics'
import { status, useTokens } from '../../src/theme'
import type { Address } from '../../src/types'

// Mirror of controller-service components/shared/CheckoutReviewPage.tsx (the storefront's /checkout/review) at the
// mobile breakpoint. Placing the order hands off to checkout/payment, which runs Razorpay or the COD order.

interface ShippingQuote {
  charge?: number | null
  codFee?: number | null
  serviceable?: boolean
  source?: string
  freeShippingThreshold?: number
  error?: string
}

const CARD = 'rounded-lg border border-border-default bg-surface-elevated p-4 shadow-sm'
const PROMISES = [
  'Orders placed before 5 PM are dispatched the same day',
  'Tracked shipment with SMS & email updates',
  'Secure packaging to ensure safe delivery',
]

function eddLabel(ymd: string) {
  return new Date(ymd + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })
}

/** An address choice: radio, name, two address lines and the phone. */
function AddressSkeleton() {
  return (
    <View className="flex-row items-start gap-4 rounded-lg border-2 border-border-default p-4">
      <Skeleton width={20} height={20} rounded="rounded-full" className="mt-1" />
      <View className="flex-1 gap-2">
        <Skeleton height={15} width="45%" />
        <Skeleton height={12} width="85%" rounded="rounded" />
        <Skeleton height={12} width="60%" rounded="rounded" />
        <Skeleton height={12} width="40%" rounded="rounded" />
      </View>
    </View>
  )
}

/** The loaded review's shape: address card, item rows, delivery date, summary. */
function ReviewLoading() {
  return (
    <View className="flex-1 overflow-hidden px-4 pt-4">
      <View className="gap-6">
        <View className={CARD}>
          <View className="mb-4 flex-row items-center justify-between">
            <Skeleton height={22} width={160} />
            <Skeleton height={14} width={110} rounded="rounded" />
          </View>
          <AddressSkeleton />
        </View>
        <View className={CARD}>
          <Skeleton height={22} width={180} className="mb-6" />
          <View className="gap-4">
            {[0, 1].map(i => (
              <View key={i} className={`flex-row gap-4 pb-4 ${i === 0 ? 'border-b border-border-default' : ''}`}>
                <Skeleton width={80} height={80} />
                <View className="flex-1 gap-2">
                  <Skeleton height={15} />
                  <Skeleton height={15} width="55%" />
                  <Skeleton height={12} width="40%" rounded="rounded" className="mt-1" />
                  <Skeleton height={14} width={80} />
                </View>
              </View>
            ))}
          </View>
        </View>
        <View className="flex-row items-start gap-4 rounded-lg border border-border-default bg-surface-elevated p-4">
          <Skeleton width={32} height={32} />
          <View className="flex-1 gap-2">
            <Skeleton height={12} width={110} rounded="rounded" />
            <Skeleton height={20} width={180} />
          </View>
        </View>
        <SummarySkeleton />
      </View>
    </View>
  )
}

export default function CheckoutReviewScreen() {
  const router = useRouter()
  const qc = useQueryClient()
  const t = useTokens()
  const params = useLocalSearchParams<{ intent?: string; couponCode?: string; addressId?: string }>()
  const intentToken = params.intent || null
  const couponFromParams = params.couponCode || null
  const user = useAuthStore(s => s.user)
  const authLoading = useAuthStore(s => s.isLoading)
  const { razorpayEnabled, codEnabled, gstEnabled } = useStoreConfig().flags
  const submitError = useCheckoutStore(s => s.submitError)
  const existingOrder = useCheckoutStore(s => s.existingOrder)

  // ── data ──
  const intentQ = useQuery({
    queryKey: ['checkout-intent', intentToken],
    queryFn: () => getCheckoutIntent(intentToken!),
    enabled: !!intentToken && !!user,
    retry: false,
    staleTime: Infinity,
  })
  const buyNow: BuyNowIntent | null = intentQ.data?.mode === 'buyNow' ? intentQ.data : null
  const isBuyNow = !!buyNow
  const intentPending = !!intentToken && (intentQ.isLoading || (!intentQ.data && !intentQ.isError))
  const imageQ = useQuery({
    queryKey: ['primary-image', buyNow?.productId, buyNow?.variantId ?? null],
    queryFn: () => getPrimaryImage(buyNow!.productId, buyNow!.variantId),
    enabled: !!buyNow,
    retry: false,
  })

  const cartQ = useQuery({ queryKey: ['cart'], queryFn: getCart, enabled: !!user })
  const cartItems = cartQ.data?.items ?? []
  const cartCount = cartItems.length

  // begin_checkout once per visit, after the buy-now line or the cart has loaded (the web's rule).
  const beganCheckout = useRef(false)
  useEffect(() => {
    if (beganCheckout.current || intentPending) return
    if (isBuyNow) {
      beganCheckout.current = true
      trackBeginCheckout([
        {
          sku: buyNow!.sku,
          name: buyNow!.productName,
          price: buyNow!.price,
          quantity: buyNow!.qty,
          variant: buyNow!.subVariantName || buyNow!.variantName,
        },
      ])
      return
    }
    if (!cartQ.isSuccess || cartItems.length === 0) return
    beganCheckout.current = true
    trackBeginCheckout(
      cartItems.map(i => ({
        sku: i.sub_variant?.sku || i.variant?.sku || i.products?.sku,
        name: i.products?.name || '',
        price: Number(
          Number(i.price_at_addition) > 0
            ? i.price_at_addition
            : (i.sub_variant?.price ?? i.variant?.price ?? i.products?.base_price ?? 0)
        ),
        quantity: Number(i.quantity) || 1,
        variant: i.sub_variant?.sub_variant_name || i.variant?.variant_name || null,
      }))
    )
  }, [intentPending, isBuyNow, buyNow, cartQ.isSuccess, cartItems])

  const addrQ = useQuery({ queryKey: ['addresses'], queryFn: listAddresses, enabled: !!user })
  const addresses = addrQ.data ?? []
  const [selectedAddress, setSelectedAddress] = useState<Address | null>(null)
  const [showAddressModal, setShowAddressModal] = useState(false)

  const settingsQ = useQuery({ queryKey: ['store-settings'], queryFn: getStoreSettings, staleTime: 300_000 })
  const minOrderAmount = typeof settingsQ.data?.minOrderAmount === 'number' ? settingsQ.data.minOrderAmount : 0

  const [couponCode, setCouponCode] = useState('')
  const [appliedCoupon, setAppliedCoupon] = useState<CouponResult | null>(null)
  const [couponError, setCouponError] = useState('')
  const [isApplyingCoupon, setIsApplyingCoupon] = useState(false)
  const [notes, setNotes] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PayMethod>(razorpayEnabled ? 'razorpay' : 'cod')
  const [cancellingPrevious, setCancellingPrevious] = useState(false)

  // Fresh visit: no stale error from an earlier attempt.
  useEffect(() => {
    useCheckoutStore.getState().clearError()
  }, [])

  // Signed out → login, like the web's redirect.
  const sentToLogin = useRef(false)
  useEffect(() => {
    if (!authLoading && !user && !sentToLogin.current) {
      sentToLogin.current = true
      router.push('/(auth)/login')
    }
  }, [authLoading, user, router])

  // Default / URL-chosen address once the list arrives.
  useEffect(() => {
    if (!addrQ.data) return
    setSelectedAddress(prev => {
      if (prev && addrQ.data.some(a => a.id === prev.id)) return addrQ.data.find(a => a.id === prev.id) ?? prev
      if (prev) return prev
      const fromUrl = params.addressId ? addrQ.data.find(a => a.id === params.addressId) : null
      return fromUrl || addrQ.data.find(a => a.is_default) || addrQ.data[0] || null
    })
  }, [addrQ.data, params.addressId])

  // An expired / foreign intent goes home; an empty cart goes back to the cart (only while this screen is on top).
  useFocusEffect(
    useCallback(() => {
      if (intentQ.isError) {
        router.replace('/(tabs)')
        return
      }
      if (!user || intentPending || isBuyNow || !cartQ.isSuccess) return
      if (cartQ.data.items.length === 0) router.replace('/(tabs)/cart')
    }, [intentQ.isError, user, intentPending, isBuyNow, cartQ.isSuccess, cartQ.data, router])
  )

  // ── money ──
  const cartSubtotal = isBuyNow ? buyNow!.price * buyNow!.qty : cartTotal(cartItems, gstEnabled)
  const hasDigital = isBuyNow ? !!buyNow!.isDigital : cartItems.some(isDigitalLine)
  const allDigital = isBuyNow ? !!buyNow!.isDigital : cartItems.length > 0 && cartItems.every(isDigitalLine)
  const physicalSubtotal = isBuyNow ? cartSubtotal : Math.max(0, cartSubtotal - digitalLinesSubtotal(cartItems, gstEnabled))
  const businessDiscountAmount = isBuyNow && Number(buyNow!.businessDiscount) > 0 ? Math.round(Number(buyNow!.businessDiscount) * 100) / 100 : 0
  const pin = selectedAddress?.postal_code ?? null

  const shipItems = isBuyNow
    ? [{ productId: buyNow!.productId, variantId: buyNow!.variantId, subVariantId: buyNow!.subVariantId, quantity: buyNow!.qty }]
    : cartItems
        .filter(i => !isDigitalLine(i))
        .map(i => ({ productId: i.product_id, variantId: i.variant_id || null, subVariantId: i.sub_variant_id || null, quantity: parseFloat(String(i.quantity)) }))
  const isCod = paymentMethod === 'cod'
  const shipQ = useQuery({
    queryKey: ['shipping-rate', pin, physicalSubtotal, isCod, JSON.stringify(shipItems)],
    queryFn: () =>
      api<ShippingQuote>('/api/shipping/rate', {
        method: 'POST',
        body: JSON.stringify({ destinationPin: pin, cartItems: shipItems, subtotal: physicalSubtotal, isCod }),
      }),
    enabled: !!pin && cartSubtotal > 0 && !allDigital && shipItems.length > 0,
    retry: false,
  })

  let shippingCharge: number | null = null
  let shippingError = ''
  let serviceable = true
  let shippingMeta: { source?: string; freeShippingThreshold?: number } | null = null
  const isLoadingShipping = shipQ.isFetching
  if (pin && cartSubtotal > 0) {
    if (allDigital) shippingCharge = 0
    else if (shipQ.isError) shippingError = 'Could not fetch rate'
    else if (shipQ.data) {
      if (shipQ.data.serviceable === false) {
        serviceable = false
        shippingError = 'Delivery is not available to this pincode.'
      } else if (shipQ.data.charge != null) {
        shippingCharge = Number(shipQ.data.charge)
        shippingMeta = { source: shipQ.data.source, freeShippingThreshold: shipQ.data.freeShippingThreshold }
      } else shippingError = shipQ.data.error || 'Unavailable'
    }
  }
  const codFee = isCod && shipQ.data?.codFee != null ? Number(shipQ.data.codFee) : 0

  const physical = cartItems.filter(i => !isDigitalLine(i))
  const extraDays = isBuyNow ? Number(buyNow!.extraDeliveryDays ?? 0) : Math.max(0, ...physical.map(i => Number(i.products?.extra_delivery_days ?? 0)))
  const handlingDays = isBuyNow ? Number(buyNow!.handlingDays ?? 0) : Math.max(0, ...physical.map(i => Number(i.products?.handling_days ?? 0)))
  const eddQ = useQuery({
    queryKey: ['checkout-edd', pin, extraDays, handlingDays],
    queryFn: () => api<{ edd?: string }>(`/api/products/edd?pin=${pin}&extraDays=${extraDays}&handlingDays=${handlingDays}`),
    enabled: !!pin && !allDigital,
    retry: false,
  })

  const discountAmount = appliedCoupon?.discountAmount ?? 0
  const finalTotal = Math.max(0, cartSubtotal - discountAmount - businessDiscountAmount + (shippingCharge ?? 0) + codFee)
  const belowMinimum = minOrderAmount > 0 && cartSubtotal > 0 && cartSubtotal < minOrderAmount
  const tax = isBuyNow ? 0 : cartTax(cartItems, gstEnabled)

  const codAvailable =
    !hasDigital && codEnabled && (isBuyNow ? true : cartItems.length > 0 && cartItems.every(i => i.products?.is_cod_allowed !== false))
  const noPaymentMethod = !razorpayEnabled && !codAvailable

  // Keep the chosen method valid as flags / the cart change.
  useEffect(() => {
    if (paymentMethod === 'razorpay' && !razorpayEnabled && codAvailable) setPaymentMethod('cod')
    else if (paymentMethod === 'cod' && !codAvailable && razorpayEnabled) setPaymentMethod('razorpay')
  }, [paymentMethod, razorpayEnabled, codAvailable])

  // ── coupon ──
  const runApply = async (code: string) => {
    setIsApplyingCoupon(true)
    setCouponError('')
    try {
      setAppliedCoupon(await applyCoupon({ code, subtotal: cartSubtotal }))
      setCouponError('')
    } catch (e) {
      setCouponError(e instanceof Error && e.message ? e.message : 'Invalid coupon')
      setAppliedCoupon(null)
    } finally {
      setIsApplyingCoupon(false)
    }
  }
  const handleApplyCoupon = () => {
    if (couponCode.trim()) runApply(couponCode)
  }
  // The cart's coupon arrives as ?couponCode= (and the review-coupon banner applies the same way).
  const autoApplied = useRef<string | null>(null)
  const [hintCode, setHintCode] = useState<string | null>(null)
  const pendingCode = hintCode || couponFromParams
  useEffect(() => {
    if (!pendingCode || appliedCoupon || cartSubtotal === 0 || autoApplied.current === pendingCode) return
    autoApplied.current = pendingCode
    setCouponCode(pendingCode)
    applyCoupon({ code: pendingCode, subtotal: cartSubtotal })
      .then(d => {
        if (d.couponId) setAppliedCoupon(d)
      })
      .catch(() => {})
  }, [pendingCode, appliedCoupon, cartSubtotal])

  const handleCancelPrevious = async () => {
    if (!existingOrder) return
    setCancellingPrevious(true)
    try {
      await cancelOrder(existingOrder.id)
      useCheckoutStore.getState().clearError()
      showToast('Previous order cancelled. You can now place a new order.', 'success')
      qc.invalidateQueries({ queryKey: ['orders'] })
    } catch (e) {
      useCheckoutStore.getState().fail(e instanceof Error ? e.message : 'Failed to cancel order', existingOrder)
    } finally {
      setCancellingPrevious(false)
    }
  }

  const handleSubmit = () => {
    useCheckoutStore.getState().clearError()
    if (!selectedAddress) return showToast('Please select a delivery address', 'info')
    if (belowMinimum) {
      return showToast(`Minimum order value is ₹${minOrderAmount}. Add ${money(minOrderAmount - cartSubtotal)} more to proceed.`, 'info')
    }
    if (!serviceable) return showToast('Delivery is not available to this pincode. Please use a different delivery address.', 'info')
    if (noPaymentMethod || (paymentMethod === 'razorpay' && !razorpayEnabled) || (paymentMethod === 'cod' && !codAvailable)) {
      return showToast('No payment method is available for this order.', 'info')
    }
    useCheckoutStore.getState().begin({
      mode: isBuyNow ? 'buyNow' : 'cart',
      intent: intentToken,
      address: selectedAddress,
      method: paymentMethod,
      couponId: appliedCoupon?.couponId || null,
      discountAmount: discountAmount + businessDiscountAmount,
      shippingAmount: shippingCharge ?? 0,
      codFeeAmount: codFee,
      notes,
      total: finalTotal,
    })
    router.push('/checkout/payment')
  }

  // ── render ──
  const header = <ScreenHeader title="Order Review" />
  if (!user || authLoading || cartQ.isLoading || intentPending) {
    return (
      <Screen header={header} mode="none" loading={authLoading || !!user} skeleton={<ReviewLoading />}>
        <View className="flex-1 items-center justify-center px-8">
          <Text className="mb-4 text-center text-foreground-secondary">Sign in to review your order</Text>
          <Pressable onPress={() => router.push('/(auth)/login')} className="rounded-lg bg-accent-500 px-6 py-2.5">
            <Text className="font-semibold text-white">Sign In</Text>
          </Pressable>
        </View>
      </Screen>
    )
  }

  const placeDisabled =
    !selectedAddress ||
    addresses.length === 0 ||
    belowMinimum ||
    isLoadingShipping ||
    !serviceable ||
    (paymentMethod === 'cod' && !codAvailable) ||
    (shippingCharge === null && !shippingError)

  const recapItems = isBuyNow
    ? [{ name: buyNow!.variantName ? `${buyNow!.productName} ${buyNow!.variantName}` : buyNow!.productName, category: null, brand: buyNow!.brandName ?? null, qty: buyNow!.qty }]
    : cartItems.map(it => ({
        name: it.variant?.variant_name ? `${it.products?.name} ${it.variant.variant_name}` : it.products?.name || 'Item',
        category: null,
        brand: it.products?.brand_name ?? null,
        qty: Number(it.quantity) || 1,
      }))

  return (
    <Screen header={header} mode="keyboard" scrollProps={{ showsVerticalScrollIndicator: false }}>
      <View className="gap-4">
        <View className="gap-6">
          {recapItems.length > 0 && (
            <AiInsight
              kind="recap"
              className="-mb-2"
              body={{
                cart: recapItems,
                total: Math.round((cartSubtotal || 0) * 100) / 100,
                itemCount: recapItems.reduce((s, c) => s + c.qty, 0),
              }}
            />
          )}

          {/* Delivery Address */}
          <View className={CARD}>
            <View className="mb-4 flex-row items-center justify-between">
              <Text className="text-xl font-bold text-foreground">Delivery Address</Text>
              <Pressable onPress={() => setShowAddressModal(true)}>
                <Text className="text-sm font-medium text-accent-600 dark:text-accent-400">+ Add New Address</Text>
              </Pressable>
            </View>

            {addrQ.isLoading ? (
              <View className="gap-3">
                <AddressSkeleton />
                <AddressSkeleton />
              </View>
            ) : addresses.length === 0 ? (
              <View className="items-center py-8">
                <View className="mb-4">
                  <MapPin size={64} color={t.foregroundMuted} strokeWidth={1} />
                </View>
                <Text className="mb-4 text-foreground-secondary">No saved addresses found</Text>
                <Pressable onPress={() => setShowAddressModal(true)} className="rounded-lg bg-accent-500 px-6 py-2 active:bg-accent-600">
                  <Text className="font-medium text-white">Add Delivery Address</Text>
                </Pressable>
              </View>
            ) : (
              <View className="gap-3">
                {addresses.map(address => {
                  const selected = selectedAddress?.id === address.id
                  return (
                    <Pressable
                      key={address.id}
                      onPress={() => setSelectedAddress(address)}
                      className={`flex-row items-start gap-4 rounded-lg border-2 p-4 ${selected ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/30' : 'border-border-default'}`}
                    >
                      <Radio checked={selected} className="mt-1" />
                      <View className="flex-1">
                        <View className="mb-1 flex-row flex-wrap items-center gap-2">
                          <Text className="font-semibold text-foreground">{address.full_name}</Text>
                          {address.is_default ? (
                            <View className="rounded bg-green-100 px-2 py-0.5 dark:bg-green-900/30">
                              <Text className="text-xs text-green-800 dark:text-green-300">Default</Text>
                            </View>
                          ) : null}
                          <View className="rounded bg-surface-secondary px-2 py-0.5">
                            <Text className="text-xs capitalize text-foreground-secondary">{address.address_type}</Text>
                          </View>
                        </View>
                        <Text className="text-sm text-foreground-secondary">
                          {address.address_line1}
                          {address.address_line2 ? `, ${address.address_line2}` : ''}
                        </Text>
                        {address.landmark ? <Text className="text-sm text-foreground-secondary">Landmark: {address.landmark}</Text> : null}
                        <Text className="text-sm text-foreground-secondary">
                          {address.city}, {address.state} {address.postal_code}
                        </Text>
                        <Text className="mt-1 text-sm text-foreground-secondary">Phone: {address.phone}</Text>
                      </View>
                    </Pressable>
                  )
                })}
              </View>
            )}
          </View>

          {/* Order Items */}
          <View className={CARD}>
            <Text className="mb-6 text-xl font-bold text-foreground">
              {isBuyNow ? 'Item' : `Order Items (${cartCount} ${cartCount === 1 ? 'item' : 'items'})`}
            </Text>
            <View className="gap-4">
              {isBuyNow ? (
                <BuyNowReviewRow item={buyNow!} imageUrl={imageQ.data ?? null} gstEnabled={gstEnabled} />
              ) : (
                cartItems.map((item, i) => (
                  <CartReviewRow key={item.id} item={item} gstEnabled={gstEnabled} last={i === cartItems.length - 1} />
                ))
              )}
            </View>
            {!isBuyNow && (
              <Pressable onPress={() => router.navigate('/(tabs)/cart')} className="mt-4">
                <Text className="text-center font-medium text-accent-600 dark:text-accent-400">← Modify Cart</Text>
              </Pressable>
            )}
          </View>

          {/* Expected Delivery Date */}
          <View className="rounded-lg border border-border-default bg-surface-elevated p-4">
            <View className="flex-row items-start gap-4">
              <View className="mt-0.5">
                <Truck size={32} color={t.accent500} strokeWidth={1.5} />
              </View>
              <View className="flex-1">
                {allDigital ? (
                  <>
                    <Text className="text-sm text-foreground-secondary">Delivery</Text>
                    <Text className="text-lg font-semibold text-foreground">Delivered to your vault</Text>
                    <Text className="text-sm text-foreground-muted">Available to open as soon as payment completes</Text>
                  </>
                ) : !selectedAddress ? (
                  <Text className="text-sm text-foreground-muted">Select a delivery address to see expected delivery date</Text>
                ) : eddQ.isLoading ? (
                  <View className="gap-2 py-0.5">
                    <Skeleton height={12} width={110} rounded="rounded" />
                    <Skeleton height={20} width={180} />
                  </View>
                ) : eddQ.data?.edd ? (
                  <>
                    <Text className="text-sm text-foreground-secondary">Expected Delivery</Text>
                    <Text className="text-lg font-semibold text-foreground">{eddLabel(eddQ.data.edd)}</Text>
                  </>
                ) : (
                  <Text className="text-sm text-foreground-muted">Delivery date unavailable for this pincode</Text>
                )}
              </View>
            </View>
          </View>

          {/* Delivery Promise */}
          {!allDigital && (
            <View className="rounded-lg border border-border-default bg-surface-elevated p-4">
              <View className="flex-row items-start gap-4">
                <View className="mt-0.5">
                  <Copy size={32} color={t.accent500} strokeWidth={1.5} />
                </View>
                <View className="flex-1">
                  <Text className="mb-2 font-semibold text-foreground">Our Delivery Promise</Text>
                  <View className="gap-1.5">
                    {PROMISES.map(p => (
                      <View key={p} className="flex-row items-center gap-2">
                        <Check size={16} color={status.success} strokeWidth={3} />
                        <Text className="flex-1 text-sm text-foreground-secondary">{p}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              </View>
            </View>
          )}
        </View>

        {/* Order Summary */}
        <View className={CARD}>
          <Text className="mb-6 text-xl font-bold text-foreground">Order Summary</Text>

          <View className="mb-6 gap-3">
            <View className="flex-row justify-between">
              <Text className="text-foreground-secondary">Subtotal{!isBuyNow ? ` (${cartCount} items)` : ''}</Text>
              <Text className="text-foreground-secondary">{money(cartSubtotal)}</Text>
            </View>
            {!isBuyNow && gstEnabled && (
              <View className="flex-row justify-between">
                <Text className="text-sm text-foreground-muted">Incl. GST</Text>
                <Text className="text-sm text-foreground-muted">{money(tax)}</Text>
              </View>
            )}
            {appliedCoupon && (
              <View className="flex-row justify-between">
                <Text className="text-sm font-medium text-green-600 dark:text-green-400">Coupon ({appliedCoupon.code})</Text>
                <Text className="text-sm font-medium text-green-600 dark:text-green-400">−{money(appliedCoupon.discountAmount)}</Text>
              </View>
            )}
            {businessDiscountAmount > 0 && (
              <View className="flex-row justify-between">
                <Text className="text-sm font-medium text-green-600 dark:text-green-400">Business Discount</Text>
                <Text className="text-sm font-medium text-green-600 dark:text-green-400">−{money(businessDiscountAmount)}</Text>
              </View>
            )}
            <View className="flex-row items-center justify-between">
              <Text className="text-foreground-secondary">Delivery Charges</Text>
              {allDigital ? (
                <Text className="font-medium text-green-600 dark:text-green-400">Delivered to your vault</Text>
              ) : isLoadingShipping ? (
                <Skeleton height={14} width={64} />
              ) : shippingError ? (
                <Text className="text-sm text-yellow-600 dark:text-yellow-400">Unavailable</Text>
              ) : shippingCharge != null ? (
                shippingCharge === 0 ? (
                  <Text className="font-medium text-green-600 dark:text-green-400">Free</Text>
                ) : (
                  <Text className="font-medium text-foreground-secondary">{money(shippingCharge)}</Text>
                )
              ) : (
                <Text className="text-sm text-foreground-muted">Select address</Text>
              )}
            </View>
            {shippingCharge === 0 && shippingMeta?.source === 'free_threshold' && shippingMeta.freeShippingThreshold ? (
              <Text className="-mt-1 text-xs text-green-600 dark:text-green-400">
                Free delivery on orders above ₹{shippingMeta.freeShippingThreshold.toLocaleString('en-IN')}
              </Text>
            ) : null}
            {shippingCharge === 0 && shippingMeta?.source === 'admin_disabled' ? (
              <Text className="-mt-1 text-xs text-green-600 dark:text-green-400">Free delivery on every order</Text>
            ) : null}
            {isCod && codFee > 0 && (
              <View className="flex-row justify-between">
                <Text className="text-sm text-foreground-secondary">COD handling fee</Text>
                <Text className="text-sm text-foreground-secondary">{money(codFee)}</Text>
              </View>
            )}
            <View className="border-t border-border-default pt-3">
              <View className="flex-row justify-between">
                <Text className="text-xl font-bold text-foreground">Total</Text>
                <Text className="text-xl font-bold text-foreground">{money(finalTotal)}</Text>
              </View>
              {gstEnabled && <Text className="mt-1 text-xs text-foreground-muted">Price inclusive of all taxes</Text>}
            </View>
          </View>

          {/* Coupon */}
          <View className="mb-6">
            {appliedCoupon ? (
              <View className="flex-row items-center justify-between rounded-lg border border-green-200 bg-green-50 px-3 py-2 dark:border-green-800 dark:bg-green-900/20">
                <View className="flex-1">
                  <Text className="text-sm font-semibold text-green-700 dark:text-green-400">{appliedCoupon.code}</Text>
                  {appliedCoupon.description ? (
                    <Text className="text-xs text-green-600 dark:text-green-500">{appliedCoupon.description}</Text>
                  ) : null}
                </View>
                <Pressable
                  onPress={() => {
                    setAppliedCoupon(null)
                    setCouponCode('')
                    setCouponError('')
                  }}
                  className="ml-3"
                >
                  <Text className="text-xs font-medium text-red-500">Remove</Text>
                </Pressable>
              </View>
            ) : (
              <View>
                <CouponHintBanner hidden={!!couponFromParams || !!hintCode} onApply={setHintCode} />
                <Text className="mb-1.5 text-sm font-medium text-foreground-secondary">Have a coupon?</Text>
                <View className="flex-row gap-2">
                  <TextInput
                    value={couponCode}
                    onChangeText={v => {
                      setCouponCode(v.toUpperCase())
                      setCouponError('')
                    }}
                    onSubmitEditing={handleApplyCoupon}
                    placeholder="Enter code"
                    placeholderTextColor={t.foregroundMuted}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    returnKeyType="done"
                    className="flex-1 rounded-lg border border-border-secondary bg-surface px-3 py-2 text-sm text-foreground"
                  />
                  <Pressable
                    onPress={handleApplyCoupon}
                    disabled={isApplyingCoupon || !couponCode.trim()}
                    className={`justify-center rounded-lg px-4 py-2 ${isApplyingCoupon || !couponCode.trim() ? 'bg-accent-300' : 'bg-accent-500 active:bg-accent-600'}`}
                  >
                    <Text className="text-sm font-semibold text-white">{isApplyingCoupon ? '...' : 'Apply'}</Text>
                  </Pressable>
                </View>
                {couponError ? <Text className="mt-1 text-xs text-red-500">{couponError}</Text> : null}
              </View>
            )}
          </View>

          {belowMinimum && (
            <Text className="mb-3 text-center text-xs font-medium text-red-500">
              Minimum order ₹{minOrderAmount} — add {money(minOrderAmount - cartSubtotal)} more to proceed.
            </Text>
          )}

          {/* Order Notes */}
          <View className="mb-4">
            <Text className="mb-1.5 text-sm font-medium text-foreground-secondary">Order Notes (Optional)</Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              placeholder="Any special instructions..."
              placeholderTextColor={t.foregroundMuted}
              className="min-h-[72px] w-full rounded-lg border border-border-secondary bg-surface px-3 py-2 text-sm text-foreground"
            />
          </View>

          {/* Payment Method */}
          <View className="mb-4 gap-2">
            <Text className="text-sm font-medium text-foreground-secondary">Payment Method</Text>
            {razorpayEnabled && (
              <Pressable
                onPress={() => setPaymentMethod('razorpay')}
                className={`flex-row items-center gap-3 rounded-lg border-2 p-3 ${paymentMethod === 'razorpay' ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/30' : 'border-border-default'}`}
              >
                <Radio checked={paymentMethod === 'razorpay'} />
                <View>
                  <Text className="text-sm font-semibold text-foreground">Pay Online</Text>
                  <Text className="text-xs text-foreground-secondary">UPI, Cards, Net Banking</Text>
                </View>
              </Pressable>
            )}
            {codAvailable && (
              <Pressable
                onPress={() => setPaymentMethod('cod')}
                className={`flex-row items-center gap-3 rounded-lg border-2 p-3 ${paymentMethod === 'cod' ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/30' : 'border-border-default'}`}
              >
                <Radio checked={paymentMethod === 'cod'} />
                <View>
                  <Text className="text-sm font-semibold text-foreground">Cash on Delivery</Text>
                  <Text className="text-xs text-foreground-secondary">Pay when your order arrives</Text>
                </View>
              </Pressable>
            )}
            {noPaymentMethod && <Text className="text-xs text-red-600 dark:text-red-400">No payment method is available for this order.</Text>}
            {!serviceable && (
              <Text className="text-xs text-red-600 dark:text-red-400">
                Delivery is not available to this pincode. Please use a different delivery address.
              </Text>
            )}
          </View>

          {submitError ? (
            <View className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 dark:border-red-800 dark:bg-red-900/30">
              <Text className="text-sm text-red-700 dark:text-red-300">{submitError}</Text>
              {existingOrder && (
                <View className="mt-2 flex-row flex-wrap gap-2">
                  <Pressable
                    onPress={() => router.push(`/orders/${existingOrder.id}`)}
                    className="rounded-lg bg-accent-500 px-3 py-1.5 active:bg-accent-600"
                  >
                    <Text className="text-xs font-medium text-white">Go to Order #{existingOrder.orderNumber}</Text>
                  </Pressable>
                  <Pressable
                    onPress={handleCancelPrevious}
                    disabled={cancellingPrevious}
                    className={`rounded-lg px-3 py-1.5 ${cancellingPrevious ? 'bg-red-300' : 'bg-red-600 active:bg-red-700'}`}
                  >
                    <Text className="text-xs font-medium text-white">{cancellingPrevious ? 'Cancelling...' : 'Cancel Previous Order'}</Text>
                  </Pressable>
                </View>
              )}
            </View>
          ) : null}

          {noPaymentMethod ? (
            <View className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-800 dark:bg-red-900/30">
              <Text className="text-sm text-red-700 dark:text-red-300">
                We are unable to accept orders right now due to a technical issue. Please try again later or contact support.
              </Text>
            </View>
          ) : (
            <Pressable
              onPress={handleSubmit}
              disabled={placeDisabled}
              className={`w-full flex-row items-center justify-center rounded-lg px-6 py-3 ${placeDisabled ? 'bg-gray-300 dark:bg-gray-700' : 'bg-accent-500 active:bg-accent-600'}`}
            >
              {isLoadingShipping ? (
                <>
                  <ActivityIndicator size="small" color={status.white} />
                  <Text className="ml-2 font-semibold text-white">Calculating delivery…</Text>
                </>
              ) : paymentMethod === 'razorpay' && razorpayEnabled ? (
                <>
                  <ShieldCheck size={20} color={status.white} strokeWidth={2} />
                  <Text className="ml-2 font-semibold text-white">Pay {money(finalTotal)}</Text>
                </>
              ) : paymentMethod === 'cod' ? (
                <>
                  <Text className="font-semibold text-white">Place Order — Pay on Delivery</Text>
                  <View className="ml-2">
                    <Banknote size={20} color={status.white} strokeWidth={2} />
                  </View>
                </>
              ) : (
                <>
                  <Text className="font-semibold text-white">Place Order</Text>
                  <View className="ml-2">
                    <Check size={20} color={status.white} strokeWidth={2} />
                  </View>
                </>
              )}
            </Pressable>
          )}

          {isBuyNow ? (
            <Pressable onPress={() => router.back()} className="mt-4">
              <Text className="text-center font-medium text-foreground-secondary">← Go Back</Text>
            </Pressable>
          ) : (
            <Pressable onPress={() => router.navigate('/(tabs)/cart')} className="mt-4">
              <Text className="text-center font-medium text-foreground-secondary">← Back to Cart</Text>
            </Pressable>
          )}

          <View className="mt-6 border-t border-border-default pt-6">
            <View className="flex-row items-center gap-2">
              <ShieldCheck size={20} color={status.success} strokeWidth={2} />
              <Text className="text-sm text-foreground-secondary">Secure Checkout</Text>
            </View>
          </View>
        </View>
      </View>

      <AddressFormModal
        isOpen={showAddressModal}
        onClose={() => setShowAddressModal(false)}
        onSaved={address => {
          setShowAddressModal(false)
          setSelectedAddress(address)
          invalidateEddCache()
          qc.invalidateQueries({ queryKey: ['addresses'] })
        }}
      />
    </Screen>
  )
}

