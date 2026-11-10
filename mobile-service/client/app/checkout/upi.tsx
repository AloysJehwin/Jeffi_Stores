import { useEffect, useRef, useState } from 'react'
import { AppState, BackHandler, InteractionManager, Linking, Platform, View } from 'react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import { Image } from 'expo-image'
import * as WebBrowser from 'expo-web-browser'
import * as Clipboard from 'expo-clipboard'
import { CircleCheck, Clock, Copy, ExternalLink, Smartphone, Users } from 'lucide-react-native'
import { Button, Card, Divider, IconButton, Notice, Screen, ScreenHeader, Spinner, Text, TextField, confirm, toast } from '../../src/ui'
import { useCheckoutStore, type ExistingOrder } from '../../src/components/checkout/checkoutStore'
import { createDraftForRequest } from '../../src/components/checkout/draft'
import { clearPendingUpi, loadPendingUpi, savePendingUpi, type PendingUpi } from '../../src/components/checkout/upiPending'
import { cancelUpiPayment, checkUpiPayment, confirmUpiUtr, getUpiStatus, startUpiPayment, type UpiPurpose, type UpiStatusResult } from '../../src/api/upi'
import { money } from '../../src/components/cart/lines'
import { useCartStore } from '../../src/stores/cartStore'
import { useTokens } from '../../src/theme'

// The UPI step (docs/plans/UPI_UPG_V2.md §2, §5, §8) for a checkout draft (from Order Review) or an unpaid
// order (pay-now). PhonePe mode opens the redirect page in the system browser and polls the intent; UPG mode
// is the native session screen (queue, pay window, UPI app buttons, check, UTR fallback), driven by the
// server's status. The intent is persisted so a killed app resumes it on relaunch (?intentId=).

// 'upg' renders from the polled status (queued / active / processing / failed / expired / cancelled).
type Phase = 'starting' | 'phonepe' | 'upg' | 'confirming' | 'awaiting' | 'failed' | 'timeout'
interface Seed {
  purpose: UpiPurpose
  draftToken?: string
  orderId?: string
  resetCart: boolean
}

const POLL_MS = 3000
const MAX_POLLS = 60
// UPG: fast while the session is live; slower (≈15 min, the late bank-alert window) once it has lapsed.
const UPG_POLL_MS = 2000
const UPG_IDLE_POLL_MS = 5000
const UPG_IDLE_MAX_POLLS = 180

const UPG_LIVE = ['queued', 'active', 'processing']

// The same pay link under each app's own scheme; "Other" is the plain upi:// link (a chooser on Android).
const UPI_APPS = [
  { id: 'gpay', label: 'Google Pay', scheme: Platform.OS === 'ios' ? 'gpay://upi/pay' : 'tez://upi/pay' },
  { id: 'phonepe', label: 'PhonePe', scheme: 'phonepe://pay' },
  { id: 'paytm', label: 'Paytm', scheme: 'paytmmp://pay' },
] as const
const appUrl = (upiUri: string, scheme: string) => upiUri.replace(/^upi:\/\/pay/i, scheme)

const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const errorMessage = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback)

export default function CheckoutUpiScreen() {
  const router = useRouter()
  const qc = useQueryClient()
  const t = useTokens()
  const params = useLocalSearchParams<{ orderId?: string; intentId?: string }>()
  const resetCart = useCartStore(s => s.reset)
  const [phase, setPhase] = useState<Phase>('starting')
  const [intent, setIntent] = useState<PendingUpi | null>(null)
  const [error, setError] = useState('')
  const [utr, setUtr] = useState('')
  const [utrError, setUtrError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  // UPG: the latest status, the device→server clock offset, a 1 s tick, and the installed UPI apps.
  const [live, setLive] = useState<UpiStatusResult | null>(null)
  const [skew, setSkew] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [apps, setApps] = useState<string[] | null>(null)
  const [acting, setActing] = useState(false)
  const liveStatus = useRef<string | null>(null)
  const phaseRef = useRef<Phase>('starting')
  const started = useRef(false)
  const done = useRef(false)
  const seed = useRef<Seed | null>(null)
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const polls = useRef(0)
  // Pushed from the order page: finishing goes back to it; a relaunch resume has nothing underneath.
  const fromOrderPage = !!params.orderId

  phaseRef.current = phase

  const stopPolling = () => {
    if (pollTimer.current) clearTimeout(pollTimer.current)
    pollTimer.current = null
  }

  const finish = (p: PendingUpi, orderId: string | undefined, message: string) => {
    if (done.current) return
    done.current = true
    stopPolling()
    clearPendingUpi()
    WebBrowser.dismissBrowser().catch(() => {})
    toast.success(message)
    qc.invalidateQueries({ queryKey: ['orders'] })
    qc.invalidateQueries({ queryKey: ['orders-list'] })
    if (p.purpose === 'order_draft') {
      if (p.resetCart) resetCart()
      useCheckoutStore.getState().reset()
      qc.invalidateQueries({ queryKey: ['cart'] })
      if (router.canDismiss()) router.dismissAll()
      if (orderId) router.push({ pathname: '/checkout/confirmation', params: { orderId } })
      else router.push('/orders')
      return
    }
    if (orderId) qc.invalidateQueries({ queryKey: ['order', orderId] })
    if (fromOrderPage && router.canGoBack()) router.back()
    else if (orderId) router.replace({ pathname: '/orders/[id]', params: { id: orderId } })
    else router.replace('/orders')
  }

  const fail = (message: string) => {
    stopPolling()
    clearPendingUpi()
    WebBrowser.dismissBrowser().catch(() => {})
    setError(message)
    setPhase('failed')
  }

  /** True when the intent reached a terminal state (the screen moved on). */
  const applyStatus = (p: PendingUpi, s: UpiStatusResult): boolean => {
    if (p.mode === 'upg') {
      liveStatus.current = s.status
      setLive(s)
      const serverNow = s.serverNow ? Date.parse(s.serverNow) : NaN
      if (!Number.isNaN(serverNow)) setSkew(serverNow - Date.now())
      // The session's own states stay on this screen; a lapsed one may still complete on a late bank alert.
      if (UPG_LIVE.includes(s.status) || s.status === 'failed' || s.status === 'expired' || s.status === 'cancelled') {
        if (phaseRef.current !== 'upg' && phaseRef.current !== 'confirming') setPhase('upg')
        if (s.status === 'cancelled') {
          clearPendingUpi()
          return true
        }
        return false
      }
    }
    switch (s.status) {
      case 'completed':
        finish(p, s.result?.orderId ?? p.orderId, 'Payment successful!')
        return true
      case 'awaiting_confirmation':
        if (s.result?.orderId || p.orderId) {
          finish(p, s.result?.orderId ?? p.orderId, 'Payment noted — the store will confirm it shortly.')
          return true
        }
        if (phaseRef.current !== 'awaiting') setPhase('awaiting')
        return false
      case 'rejected':
        fail('The store could not match this payment. If money left your account, contact the store with your UTR.')
        return true
      case 'failed':
        fail('The payment did not go through. No money has been taken — you can try again.')
        return true
      case 'expired':
        fail('This payment request expired before it was paid. Start again to get a fresh one.')
        return true
      default:
        return false
    }
  }

  const check = async (p: PendingUpi): Promise<boolean> => {
    try {
      return applyStatus(p, await getUpiStatus(p.intentId))
    } catch {
      return false
    }
  }

  const upgDelay = (p: PendingUpi) => (p.mode !== 'upg' ? POLL_MS : UPG_LIVE.includes(liveStatus.current ?? '') ? UPG_POLL_MS : UPG_IDLE_POLL_MS)

  const schedule = (p: PendingUpi) => {
    stopPolling()
    pollTimer.current = setTimeout(async () => {
      polls.current += 1
      if ((await check(p)) || done.current) return
      const liveUpg = p.mode === 'upg' && UPG_LIVE.includes(liveStatus.current ?? '')
      if (liveUpg) polls.current = 0
      else if (polls.current >= (p.mode === 'upg' ? UPG_IDLE_MAX_POLLS : MAX_POLLS)) {
        // A noted payment awaits the store anyway; a PhonePe one that never came back asks the user.
        if (phaseRef.current === 'phonepe') setPhase('timeout')
        return
      }
      schedule(p)
    }, upgDelay(p))
  }

  const openBrowser = async (url: string, p: PendingUpi) => {
    try {
      // Android resolves as soon as the tab opens; iOS when it's dismissed — a check then costs nothing.
      await WebBrowser.openBrowserAsync(url, { dismissButtonStyle: 'close', showTitle: false })
    } catch {
      await Linking.openURL(url).catch(() => toast.error('Could not open the payment page.'))
    }
    if (!done.current) check(p)
  }

  const begin = async (s: Seed) => {
    seed.current = s
    done.current = false
    polls.current = 0
    setError('')
    setUtr('')
    setUtrError(null)
    setLive(null)
    liveStatus.current = null
    setPhase('starting')
    try {
      const res = await startUpiPayment({ purpose: s.purpose, ...(s.draftToken ? { draftToken: s.draftToken } : {}), ...(s.orderId ? { orderId: s.orderId } : {}) })
      const p: PendingUpi = {
        intentId: res.intentId,
        purpose: s.purpose,
        mode: res.mode,
        draftToken: s.draftToken,
        orderId: s.orderId,
        amountPaise: res.amountPaise,
        redirectUrl: res.redirectUrl,
        resetCart: s.resetCart,
        startedAt: Date.now(),
      }
      setIntent(p)
      await savePendingUpi(p)
      if (res.mode === 'upg') {
        setPhase('upg')
        if (!(await check(p)) && !done.current) schedule(p)
        return
      }
      if (!res.redirectUrl) throw new Error('The payment page could not be opened.')
      setPhase('phonepe')
      schedule(p)
      openBrowser(res.redirectUrl, p)
    } catch (e) {
      fail(errorMessage(e, 'Could not start the UPI payment. Please try again.'))
    }
  }

  // Back to Order Review, which shows the error (and the unpaid-order actions on a 409).
  const abortToReview = (message: string, existing?: ExistingOrder | null) => {
    done.current = true
    useCheckoutStore.getState().fail(message, existing ?? null)
    if (router.canGoBack()) router.back()
    else router.replace('/checkout/review')
  }

  /** Give up on this intent: nothing is charged until it completes, so leaving is safe. */
  const leave = () => {
    done.current = true
    stopPolling()
    clearPendingUpi()
    // A waiting UPG session holds the store's UPI slot (or a place in line) — release it.
    if (intent?.mode === 'upg' && (liveStatus.current === 'queued' || liveStatus.current === 'active')) cancelUpiPayment(intent.intentId).catch(() => {})
    if (router.canGoBack()) router.back()
    else router.replace(intent?.purpose === 'order' || params.intentId ? '/orders' : '/checkout/review')
  }

  const checkNow = async () => {
    if (!intent || checking) return
    setChecking(true)
    polls.current = 0
    const terminal = await check(intent)
    setChecking(false)
    if (terminal || done.current) return
    if (phaseRef.current === 'timeout') setPhase('phonepe')
    schedule(intent)
  }

  /** Leaving an open pay window cancels it; someone who has just paid should check instead. */
  const cancelUpg = async () => {
    if (liveStatus.current === 'active') {
      const ok = await confirm({
        title: 'Cancel this payment?',
        message: "If you've already paid in your UPI app, go back and tap \"Payment done\" instead.",
        confirmLabel: 'Cancel payment',
        cancelLabel: 'Keep waiting',
        destructive: true,
      })
      if (!ok || done.current) return
    }
    leave()
  }

  /** "Payment done — check my payment": the server looks for the bank's credit alert for 30 s. */
  const paymentDone = async () => {
    if (!intent || acting) return
    setActing(true)
    const failed = await checkUpiPayment(intent.intentId).then(() => null, (e: unknown) => e)
    polls.current = 0
    if (!(await check(intent)) && !done.current) schedule(intent)
    // Only worth saying when the session didn't move on by itself.
    if (failed && !done.current && liveStatus.current === 'active') toast.error(errorMessage(failed, 'Could not check the payment. Please try again.'))
    setActing(false)
  }

  const openUpiApp = (url: string, name: string) => {
    Linking.openURL(url).catch(() => toast.error(`${name} could not be opened. Scan the QR or pay to the UPI ID instead.`))
  }

  const submitUtr = async () => {
    if (!intent) return
    const value = utr.trim().toUpperCase()
    if (!/^[A-Z0-9]{6,}$/.test(value)) {
      setUtrError('Enter the UTR / transaction ID shown in your UPI app (usually 12 digits).')
      return
    }
    setUtrError(null)
    setPhase('confirming')
    try {
      await confirmUpiUtr(intent.intentId, value)
    } catch (e) {
      setPhase('upg')
      setUtrError(errorMessage(e, 'Could not record the payment. Please try again.'))
      return
    }
    setPhase('awaiting')
    polls.current = 0
    if (!(await check(intent)) && !done.current) schedule(intent)
  }

  const copyVpa = async () => {
    if (!live?.payee?.vpa) return
    await Clipboard.setStringAsync(live.payee.vpa)
    toast.success('UPI ID copied')
  }

  useEffect(() => {
    if (started.current) return
    started.current = true
    const run = async () => {
      if (params.intentId) {
        const p = await loadPendingUpi()
        if (!p || p.intentId !== params.intentId) {
          router.replace('/orders')
          return
        }
        seed.current = { purpose: p.purpose, draftToken: p.draftToken, orderId: p.orderId, resetCart: p.resetCart }
        setIntent(p)
        setPhase(p.mode === 'upg' ? 'upg' : 'phonepe')
        if (!(await check(p)) && !done.current) schedule(p)
        return
      }
      if (params.orderId) {
        await begin({ purpose: 'order', orderId: params.orderId, resetCart: false })
        return
      }
      const r = useCheckoutStore.getState().request
      if (!r || r.method !== 'upi') {
        router.replace('/checkout/review')
        return
      }
      const draft = await createDraftForRequest(r)
      if (!draft.ok) return abortToReview(draft.error, draft.existing)
      await begin({ purpose: 'order_draft', draftToken: draft.draftToken, resetCart: r.mode !== 'buyNow' })
    }
    // Let the push transition settle before the browser opens.
    InteractionManager.runAfterInteractions(() => {
      run().catch((e: unknown) => {
        if (params.orderId || params.intentId) fail(errorMessage(e, 'Could not reach the server. Please try again.'))
        else abortToReview(errorMessage(e, 'Could not reach the server. Please try again.'))
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Coming back from the browser / a UPI app: Android pauses JS timers while another activity is up, so
  // the poll resumes here; hardware back leaves (never mid-request).
  useEffect(() => {
    const app = AppState.addEventListener('change', state => {
      if (state === 'active' && intent && !done.current && (phaseRef.current === 'phonepe' || phaseRef.current === 'upg' || phaseRef.current === 'awaiting')) {
        setNow(Date.now())
        polls.current = 0
        check(intent).then(terminal => {
          if (!terminal && !done.current) schedule(intent)
        })
      }
    })
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      if (phaseRef.current === 'upg') cancelUpg()
      else if (phaseRef.current !== 'starting' && phaseRef.current !== 'confirming') leave()
      return true
    })
    return () => {
      app.remove()
      back.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent])

  useEffect(() => () => stopPolling(), [])

  const upg = phase === 'upg' ? live : null
  const ticking = upg?.status === 'active' || upg?.status === 'processing'
  useEffect(() => {
    if (!ticking) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [ticking])

  // Which UPI apps are installed (needs the schemes declared in the native build; none found → offer them all).
  useEffect(() => {
    if (phase !== 'upg' || apps) return
    let alive = true
    Promise.all(UPI_APPS.map(a => Linking.canOpenURL(`${a.scheme}?pa=test@upi`).catch(() => false))).then(found => {
      if (alive) setApps(UPI_APPS.filter((_, i) => found[i]).map(a => a.id))
    })
    return () => {
      alive = false
    }
  }, [phase, apps])

  const busy = phase === 'starting' || phase === 'confirming'
  const amount = intent ? money(intent.amountPaise / 100) : ''
  const lapsed = upg?.status === 'failed' || upg?.status === 'expired'
  const left = (iso?: string | null) => (iso ? Date.parse(iso) - (now + skew) : 0)
  const shownApps = apps?.length ? UPI_APPS.filter(a => apps.includes(a.id)) : UPI_APPS

  return (
    <Screen header={<ScreenHeader title="UPI Payment" back={!busy} onBack={phase === 'upg' ? cancelUpg : leave} menu={false} />} mode={lapsed ? 'keyboard' : 'scroll'}>
      <Stack.Screen options={{ gestureEnabled: !busy }} />
      {phase === 'starting' ? (
        <Spinner label="Starting UPI payment…" />
      ) : phase === 'confirming' ? (
        <Spinner label="Noting your payment…" />
      ) : phase === 'phonepe' ? (
        <Card className="items-center gap-4 p-6">
          <View className="h-12 w-12 items-center justify-center rounded-full bg-accent-100 dark:bg-accent-900/30">
            <Smartphone size={24} color={t.accent600} strokeWidth={1.8} />
          </View>
          <Text accessibilityRole="header" className="text-center font-display text-lg font-extrabold text-foreground">
            Complete the payment in your UPI app
          </Text>
          <Text className="text-center text-sm leading-5 text-foreground-secondary">
            Pick your UPI app on the payment page and approve {amount}. This screen updates on its own once the payment goes through.
          </Text>
          <View className="flex-row items-center gap-2">
            <Spinner size="small" fill={false} />
            <Text className="text-sm text-foreground-muted">Waiting for payment…</Text>
          </View>
          <View className="w-full gap-2">
            <Button label="Open payment page again" icon={ExternalLink} variant="outline" size="md" onPress={() => intent?.redirectUrl && openBrowser(intent.redirectUrl, intent)} />
            <Button label="I've paid — check now" variant="ghost" size="md" loading={checking} loadingLabel="Checking…" onPress={checkNow} />
            <Button label="Cancel" variant="ghost" size="md" onPress={leave} />
          </View>
        </Card>
      ) : upg?.status === 'queued' ? (
        <Card className="items-center gap-4 p-6">
          <View className="h-12 w-12 items-center justify-center rounded-full bg-accent-100 dark:bg-accent-900/30">
            <Users size={24} color={t.accent600} strokeWidth={1.8} />
          </View>
          <Text accessibilityRole="header" accessibilityLiveRegion="polite" className="text-center font-display text-lg font-extrabold text-foreground">
            {upg.queuePosition ? `You're #${upg.queuePosition} in line` : "You're in line"}
          </Text>
          <Text className="text-center text-sm leading-5 text-foreground-secondary">
            The store takes one UPI payment at a time. Your turn to pay {amount} comes up on its own — keep this screen open.
          </Text>
          <View className="flex-row items-center gap-2">
            <Spinner size="small" fill={false} />
            <Text className="text-sm text-foreground-muted">Waiting for your turn…</Text>
          </View>
          <View className="w-full">
            <Button label="Cancel" variant="ghost" size="md" onPress={cancelUpg} />
          </View>
        </Card>
      ) : upg?.status === 'active' ? (
        <Card className="gap-4">
          <View className="flex-row items-start justify-between gap-3">
            <View className="flex-1">
              <Text accessibilityRole="header" className="font-display text-xl font-extrabold text-foreground">
                Pay {amount} via UPI
              </Text>
              <Text className="mt-1 text-sm leading-5 text-foreground-secondary">Pay the exact amount, then come back and tap "Payment done".</Text>
            </View>
            <View className="flex-row items-center gap-1.5 rounded-full bg-surface-secondary px-3 py-1.5" accessibilityLabel={`Time left ${clock(left(upg.payExpiresAt))}`}>
              <Clock size={14} color={t.foregroundMuted} strokeWidth={2} />
              <Text className="text-sm font-bold text-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                {clock(left(upg.payExpiresAt))}
              </Text>
            </View>
          </View>
          {upg.payee && (
            <View className="gap-1 rounded-field bg-surface-secondary px-4 py-3">
              <Text className="text-xs font-medium text-foreground-muted">Pay to</Text>
              <Text className="text-[15px] font-semibold text-foreground">{upg.payee.name}</Text>
              <View className="flex-row items-center justify-between gap-2">
                <Text selectable className="flex-1 text-[15px] text-foreground" numberOfLines={1}>
                  {upg.payee.vpa}
                </Text>
                <IconButton icon={Copy} label="Copy UPI ID" size="sm" variant="tinted" onPress={copyVpa} />
              </View>
            </View>
          )}
          {upg.upiUri && (
            <View className="gap-2">
              {shownApps.map(a => (
                <Button key={a.id} label={`Pay with ${a.label}`} icon={Smartphone} variant="outline" size="md" onPress={() => openUpiApp(appUrl(upg.upiUri!, a.scheme), a.label)} />
              ))}
              <Button label="Other UPI app" icon={ExternalLink} variant="outline" size="md" onPress={() => openUpiApp(upg.upiUri!, 'A UPI app')} />
            </View>
          )}
          {upg.qrDataUrl && (
            <View className="items-center gap-2">
              <Text className="text-xs text-foreground-muted">Or scan with another phone</Text>
              <View className="rounded-xl bg-white p-2">
                <Image source={{ uri: upg.qrDataUrl }} style={{ width: 200, height: 200 }} contentFit="contain" accessibilityLabel="UPI payment QR code" />
              </View>
            </View>
          )}
          <Divider />
          <Button label="Payment done — check my payment" icon={CircleCheck} loading={acting} loadingLabel="Checking…" haptics onPress={paymentDone} />
          <Button label="Cancel" variant="ghost" size="md" onPress={cancelUpg} />
        </Card>
      ) : upg?.status === 'processing' ? (
        <Card className="items-center gap-4 p-6">
          <Spinner fill={false} />
          <Text accessibilityRole="header" className="text-center font-display text-lg font-extrabold text-foreground">
            Checking with your bank…
          </Text>
          <Text className="text-center text-sm leading-5 text-foreground-secondary">
            Looking for your payment of {amount}. This takes up to half a minute — please don&apos;t close the app.
          </Text>
          <Text className="font-display text-2xl font-extrabold text-foreground" style={{ fontVariant: ['tabular-nums'] }} accessibilityLabel={`${clock(left(upg.verifyExpiresAt))} left`}>
            {clock(left(upg.verifyExpiresAt))}
          </Text>
        </Card>
      ) : upg && lapsed ? (
        <Card className="gap-4">
          <View>
            <Text accessibilityRole="header" className="font-display text-xl font-extrabold text-foreground">
              We couldn&apos;t see your payment yet
            </Text>
            <Text className="mt-1 text-sm leading-5 text-foreground-secondary">
              {upg.status === 'expired' ? 'The time to pay ran out.' : "The bank hasn't told us about it."} If you paid {amount}, enter the UTR from your UPI app and the store will match it. If you didn&apos;t pay, just try again.
            </Text>
          </View>
          <TextField
            label="UTR / transaction ID"
            value={utr}
            onChangeText={v => {
              setUtr(v)
              setUtrError(null)
            }}
            onSubmitEditing={submitUtr}
            placeholder="e.g. 4152XXXXXXXX"
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="done"
            error={utrError}
            helper="The 12-digit UPI reference shown once the payment is complete."
          />
          <Button label="Submit UTR" icon={CircleCheck} disabled={!utr.trim()} haptics onPress={submitUtr} />
          <Button label="Try again" variant="outline" size="md" disabled={!seed.current} onPress={() => seed.current && begin(seed.current)} />
          <Button label="Choose another payment method" variant="ghost" size="md" onPress={leave} />
        </Card>
      ) : upg?.status === 'cancelled' ? (
        <View className="gap-4">
          <Notice tone="info" title="Payment cancelled">
            This UPI payment was cancelled. Nothing has been charged.
          </Notice>
          <Button label="Try again" size="md" disabled={!seed.current} onPress={() => seed.current && begin(seed.current)} />
          <Button label="Choose another payment method" variant="ghost" size="md" onPress={leave} />
        </View>
      ) : phase === 'upg' ? (
        <Spinner label="Loading your payment…" />
      ) : phase === 'awaiting' ? (
        <Card className="items-center gap-4 p-6">
          <View className="h-12 w-12 items-center justify-center rounded-full bg-green-50 dark:bg-green-900/20">
            <CircleCheck size={24} color={t.accent600} strokeWidth={1.8} />
          </View>
          <Text accessibilityRole="header" className="text-center font-display text-lg font-extrabold text-foreground">
            Payment noted
          </Text>
          <Text className="text-center text-sm leading-5 text-foreground-secondary">
            The store will confirm your payment of {amount} once it shows up in its account. Your order updates then — you don&apos;t need to keep this screen open.
          </Text>
          <View className="w-full gap-2">
            <Button label="Check again" variant="outline" size="md" loading={checking} loadingLabel="Checking…" onPress={checkNow} />
            <Button
              label="Go to My Orders"
              variant="ghost"
              size="md"
              onPress={() => {
                done.current = true
                stopPolling()
                clearPendingUpi()
                if (intent?.purpose === 'order_draft') useCheckoutStore.getState().reset()
                if (router.canDismiss()) router.dismissAll()
                router.push('/orders')
              }}
            />
          </View>
        </Card>
      ) : phase === 'timeout' ? (
        <Card className="gap-4 p-6">
          <Text accessibilityRole="header" className="text-center font-display text-lg font-extrabold text-foreground">
            Still waiting for the payment
          </Text>
          <Text className="text-center text-sm leading-5 text-foreground-secondary">
            We haven&apos;t heard back yet. If you completed the payment, check again in a moment — otherwise start over with a fresh request.
          </Text>
          <View className="gap-2">
            <Button label="Check again" size="md" loading={checking} loadingLabel="Checking…" onPress={checkNow} />
            <Button label="Start over" variant="outline" size="md" onPress={() => seed.current && begin(seed.current)} />
            <Button label="Choose another payment method" variant="ghost" size="md" onPress={leave} />
          </View>
        </Card>
      ) : (
        <View className="gap-4">
          <Notice tone="danger" title="UPI payment failed">
            {error || 'Something went wrong. Please try again.'}
          </Notice>
          <Button label="Try again" size="md" disabled={!seed.current} onPress={() => seed.current && begin(seed.current)} />
          <Button label="Choose another payment method" variant="ghost" size="md" onPress={leave} />
        </View>
      )}
    </Screen>
  )
}
