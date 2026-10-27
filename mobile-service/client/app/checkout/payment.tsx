import { useEffect, useRef, useState } from 'react'
import { BackHandler, InteractionManager, NativeModules, Platform, View } from 'react-native'
import { Button, Card, Notice, Screen, ScreenHeader, Spinner, Text } from '../../src/ui'
import { Stack, useRouter } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import RazorpayCheckout from 'react-native-razorpay'
import { useCheckoutStore, type PlaceOrderRequest } from '../../src/components/checkout/checkoutStore'
import { createOrderDraft, placeUnpaidOrder } from '../../src/api/orders'
import { checkPendingPayment, createRazorpayOrder, verifyPayment } from '../../src/api/razorpay'
import { useAuthStore } from '../../src/stores/authStore'
import { useCartStore } from '../../src/stores/cartStore'
import { useStoreConfig } from '../../src/hooks/useStoreConfig'
import { showToast } from '../../src/stores/toastStore'
import { absUrl } from '../../src/lib/links'
import { accent } from '../../src/theme'

// The payment step behind the storefront's Order Review: the web's in-page Razorpay modal + verify, its
// "Confirming your payment…" recovery card and /checkout/payment-callback spinner, and COD placement.
// Online payment uses the web's draft flow (orders/draft → razorpay/create-order → verify with draftToken),
// so nothing is committed until the payment verifies.

type Phase = 'processing' | 'verifying'
interface Pending {
  razorpayOrderId: string
  razorpayPaymentId: string
  razorpaySignature: string
  draftToken: string
}

const MAX_POLLS = 20

function isCancelled(err: any): boolean {
  const desc = String(err?.description ?? err?.error?.description ?? '').toLowerCase()
  if (desc.includes('cancel')) return true
  return Platform.OS === 'android' ? err?.code === 0 : err?.code === 2
}

function errorText(err: any): string {
  const raw = err?.error?.description ?? err?.description ?? err?.message
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return parsed?.error?.description || raw
    } catch {
      return raw
    }
  }
  return 'Payment failed. Please try again.'
}

export default function CheckoutPaymentScreen() {
  const router = useRouter()
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const identity = useStoreConfig().identity
  const resetCart = useCartStore(s => s.reset)
  const [request] = useState<PlaceOrderRequest | null>(() => useCheckoutStore.getState().request)
  const [phase, setPhase] = useState<Phase>('processing')
  const [pending, setPending] = useState<Pending | null>(null)
  const [error, setError] = useState('')
  const [retrying, setRetrying] = useState(false)
  const started = useRef(false)
  const done = useRef(false)
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Hardware back can't abandon a payment mid-flight.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true)
    return () => {
      sub.remove()
      if (pollTimer.current) clearTimeout(pollTimer.current)
    }
  }, [])

  const finish = (orderId: string, toast?: string) => {
    if (done.current) return
    done.current = true
    if (pollTimer.current) clearTimeout(pollTimer.current)
    if (toast) showToast(toast, 'success')
    if (request?.mode !== 'buyNow') resetCart()
    useCheckoutStore.getState().reset()
    qc.invalidateQueries({ queryKey: ['cart'] })
    qc.invalidateQueries({ queryKey: ['orders'] })
    if (router.canDismiss()) router.dismissAll()
    router.push({ pathname: '/checkout/confirmation', params: { orderId } })
  }

  // Back to the review screen, which shows the error (and the unpaid-order actions on a 409).
  const abort = (message: string, existing?: { id: string; orderNumber: string } | null) => {
    if (done.current) return
    done.current = true
    useCheckoutStore.getState().fail(message, existing ?? null)
    if (router.canGoBack()) router.back()
    else router.replace('/checkout/review')
  }

  // Verify failed after Razorpay took the money: poll the webhook-backed check until the order shows up.
  const pollPending = (p: Pending, attempt = 0) => {
    checkPendingPayment({ razorpayOrderId: p.razorpayOrderId, draftToken: p.draftToken })
      .then(d => {
        if (d.order?.id) return finish(d.order.id, 'Payment confirmed!')
        if (d.status === 'pending' && attempt < MAX_POLLS) {
          pollTimer.current = setTimeout(() => pollPending(p, attempt + 1), 3000)
        }
      })
      .catch(() => {
        if (attempt < MAX_POLLS) pollTimer.current = setTimeout(() => pollPending(p, attempt + 1), 3000)
      })
  }

  const verify = async (p: Pending) => {
    setPhase('verifying')
    setPending(p)
    setError('')
    try {
      const data = await verifyPayment({
        razorpay_order_id: p.razorpayOrderId,
        razorpay_payment_id: p.razorpayPaymentId,
        razorpay_signature: p.razorpaySignature,
        draftToken: p.draftToken,
      })
      if (!data?.order?.id) throw new Error('Payment verification failed')
      finish(data.order.id, 'Payment successful!')
    } catch {
      setError(
        `Payment received but confirmation failed. Check My Orders — if no order appears in 2 minutes, contact support with payment ID: ${p.razorpayPaymentId}`
      )
      pollPending(p)
    }
  }

  const payOnline = async (r: PlaceOrderRequest) => {
    if (!NativeModules.RNRazorpayCheckout) {
      return abort('Online payment is not available in this build of the app. Please update the app or choose another method.')
    }
    const draft = await createOrderDraft({
      mode: r.mode,
      addressId: r.address.id,
      notes: r.notes,
      couponId: r.couponId,
      ...(r.intent ? { intent: r.intent } : {}),
    })
    if (draft.status === 409 && draft.data.existingOrderId) {
      return abort(draft.data.error || 'You have an unpaid order.', {
        id: draft.data.existingOrderId,
        orderNumber: draft.data.existingOrderNumber || '',
      })
    }
    if (!draft.ok || !draft.data.draftToken) return abort(draft.data.error || 'Failed to start payment')
    const draftToken = draft.data.draftToken

    let rzp
    try {
      rzp = await createRazorpayOrder({ draftToken })
    } catch (e) {
      return abort(e instanceof Error && e.message ? e.message : 'Failed to start payment')
    }

    let paid
    try {
      paid = await RazorpayCheckout.open({
        key: rzp.key_id,
        amount: String(rzp.amount),
        currency: rzp.currency,
        name: identity.name || 'Jeffi Stores',
        description: 'Order Payment',
        order_id: rzp.razorpayOrderId,
        ...(absUrl(identity.logoUrl) ? { image: absUrl(identity.logoUrl)! } : {}),
        prefill: {
          name: r.address.full_name || '',
          email: user?.email || '',
          contact: (r.address.phone || '').replace(/\D/g, '').slice(-10),
        },
        theme: { color: accent[500] },
      })
    } catch (err: any) {
      if (isCancelled(err)) {
        showToast('Payment cancelled — your cart is still here.', 'info')
        return abort('')
      }
      return abort(errorText(err))
    }

    await verify({
      razorpayOrderId: paid.razorpay_order_id || rzp.razorpayOrderId,
      razorpayPaymentId: paid.razorpay_payment_id,
      razorpaySignature: paid.razorpay_signature || '',
      draftToken,
    })
  }

  const payOnDelivery = async (r: PlaceOrderRequest) => {
    const a = r.address
    const res = await placeUnpaidOrder(r.mode, {
      shippingAddress: {
        fullName: a.full_name,
        addressLine1: a.address_line1,
        addressLine2: a.address_line2,
        landmark: a.landmark,
        city: a.city,
        state: a.state,
        postalCode: a.postal_code,
        country: a.country,
        phone: a.phone,
      },
      notes: r.notes,
      paymentMethod: r.method === 'manual' ? 'manual' : 'cod',
      couponId: r.couponId,
      discountAmount: r.discountAmount,
      shippingAmount: r.shippingAmount,
      codFeeAmount: r.codFeeAmount,
      ...(r.intent ? { intent: r.intent } : {}),
    })
    if (res.status === 409 && res.data.existingOrderId) {
      return abort(res.data.error || 'You have an unpaid order.', {
        id: res.data.existingOrderId,
        orderNumber: res.data.existingOrderNumber || '',
      })
    }
    if (!res.ok || !res.data.order?.id) return abort(res.data.error || 'Failed to create order')
    finish(res.data.order.id)
  }

  useEffect(() => {
    if (started.current) return
    started.current = true
    if (!request) {
      router.replace('/checkout/review')
      return
    }
    // Let the push transition settle before the native sheet opens.
    InteractionManager.runAfterInteractions(() => {
      const run = request.method === 'razorpay' ? payOnline(request) : payOnDelivery(request)
      run.catch((e: unknown) => abort(e instanceof Error && e.message ? e.message : 'Could not reach the server. Please try again.'))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const retry = async () => {
    if (!pending) return
    setRetrying(true)
    await verify(pending)
    setRetrying(false)
  }

  // No back button: like the hardware back, it can't abandon a payment mid-flight.
  return (
    <Screen header={<ScreenHeader title="Payment" back={false} menu={false} />} mode="none">
      <Stack.Screen options={{ gestureEnabled: false }} />
      {phase === 'verifying' ? (
        <View className="flex-1 items-center justify-center px-4 py-8">
          <Card padded={false} className="w-full items-center gap-4 p-8">
            <View className="h-12 w-12 items-center justify-center rounded-full bg-accent-100 dark:bg-accent-900/30">
              <Spinner size="small" fill={false} />
            </View>
            <Text accessibilityRole="header" className="text-center font-display text-lg font-extrabold text-foreground">
              Confirming your payment…
            </Text>
            <Text className="text-center text-sm text-foreground-secondary">
              Your payment was received. We&apos;re confirming your order — please don&apos;t close this page.
            </Text>
            {error ? (
              <Notice tone="danger" className="w-full">
                <Text className="text-center text-sm text-red-600 dark:text-red-400">{error}</Text>
              </Notice>
            ) : null}
            {error ? (
              <View className="w-full gap-2">
                <Button label="Retry confirmation" size="md" loading={retrying} loadingLabel="Retrying…" onPress={retry} />
                <Button
                  label="Go to My Orders"
                  variant="ghost"
                  size="md"
                  onPress={() => {
                    done.current = true
                    if (pollTimer.current) clearTimeout(pollTimer.current)
                    if (router.canDismiss()) router.dismissAll()
                    router.push('/orders')
                  }}
                />
              </View>
            ) : null}
          </Card>
        </View>
      ) : (
        <Spinner label={request?.method === 'razorpay' ? 'Processing...' : 'Placing Order...'} />
      )}
    </Screen>
  )
}
