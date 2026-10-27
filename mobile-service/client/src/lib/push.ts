import { Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Constants from 'expo-constants'
import * as Notifications from 'expo-notifications'
import { registerPushDevice, unregisterPushDevice, type NotificationCategory } from '../api/notifications'
import { openPushPrompt, type PushPromptReason } from '../stores/pushPromptStore'

// Push on the device: Android channels (ids = the server's categories), the foreground handler,
// FCM token registration, and the soft-ask bookkeeping. PushBootstrap wires it up at the root.

const CHANNELS: { id: NotificationCategory; name: string; description: string; importance: Notifications.AndroidImportance }[] = [
  { id: 'orders', name: 'Order updates', description: 'Confirmed, shipped, out for delivery, delivered', importance: Notifications.AndroidImportance.HIGH },
  { id: 'account', name: 'Account', description: 'Payments, refunds and account alerts', importance: Notifications.AndroidImportance.HIGH },
  { id: 'offers', name: 'Offers', description: 'Deals and coupons', importance: Notifications.AndroidImportance.DEFAULT },
  { id: 'price_alerts', name: 'Price alerts', description: 'Price drops and back in stock', importance: Notifications.AndroidImportance.DEFAULT },
]
const QUIET = new Set<string>(['offers', 'price_alerts'])

const TOKEN_KEY = 'push.token'
const OFFERS_KEY = 'push.offersOptIn'
const DECLINED_KEY = 'push.softAskDeclinedAt'
const WELCOME_KEY = 'push.welcomeAskedAt'
const COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000

export const PUSH_PERMISSION_KEY = ['push-permission'] as const
export const OFFERS_OPT_IN_KEY = ['push-offers-opt-in'] as const

let channelsReady: Promise<void> | null = null
let currentToken: string | null = null

/** Channels and the foreground handler; safe to call more than once. */
export function initPush(): Promise<void> {
  if (!channelsReady) {
    Notifications.setNotificationHandler({
      // Order and account updates show a banner; offers only refresh the inbox and badge.
      handleNotification: async n => {
        const loud = !QUIET.has(pushData(n).category ?? '')
        return { shouldShowBanner: loud, shouldShowList: loud, shouldPlaySound: loud, shouldSetBadge: false }
      },
    })
    channelsReady =
      Platform.OS === 'android'
        ? Promise.all(
            CHANNELS.map(c => Notifications.setNotificationChannelAsync(c.id, { name: c.name, description: c.description, importance: c.importance })),
          ).then(() => undefined, () => undefined)
        : Promise.resolve()
  }
  return channelsReady
}

/** The FCM data payload: link, category, notification_id. */
export function pushData(n: Notifications.Notification): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {}
  const trigger = n.request.trigger as { type?: string; remoteMessage?: { data?: Record<string, string> } } | null
  Object.assign(out, trigger?.remoteMessage?.data)
  const data = n.request.content.data ?? {}
  if (typeof data.dataString === 'string') {
    try {
      Object.assign(out, JSON.parse(data.dataString))
    } catch {}
  }
  for (const [k, v] of Object.entries(data)) if (typeof v === 'string') out[k] = v
  return out
}

async function deviceToken(): Promise<string | null> {
  // iOS needs APNs set up first (phase 4).
  if (Platform.OS !== 'android') return null
  try {
    const t = await Notifications.getDevicePushTokenAsync()
    return typeof t.data === 'string' && t.data ? t.data : null
  } catch {
    return null
  }
}

function deviceInfo() {
  let intl: Intl.ResolvedDateTimeFormatOptions | null = null
  try {
    intl = Intl.DateTimeFormat().resolvedOptions()
  } catch {}
  const os = Platform.OS === 'android' ? `Android ${Platform.constants.Release}` : `${Platform.OS} ${Platform.Version}`
  return {
    platform: (Platform.OS === 'ios' ? 'ios' : 'android') as 'android' | 'ios',
    app_version: Constants.expoConfig?.version ?? null,
    os_version: os.slice(0, 40),
    locale: intl?.locale ?? null,
    timezone: intl?.timeZone ?? null,
  }
}

/** The install's offers consent (the signed-out toggle); undefined until chosen. */
export async function getDeviceOffersOptIn(): Promise<boolean | undefined> {
  const v = await AsyncStorage.getItem(OFFERS_KEY).catch(() => null)
  return v == null ? undefined : v === '1'
}

// Registrations run one at a time, so a launch and a sign-in can't race.
let queue: Promise<unknown> = Promise.resolve()
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn)
  queue = run.catch(() => undefined)
  return run
}

/** Register or refresh this install; attaches the signed-in user. Never throws. */
export function syncPushDevice(token?: string): Promise<boolean> {
  return serial(async () => {
    try {
      await initPush()
      const t = token ?? (await deviceToken())
      if (!t) return false
      const offers = await getDeviceOffersOptIn()
      await registerPushDevice({ token: t, ...deviceInfo(), ...(offers === undefined ? {} : { offers_opt_in: offers }) })
      currentToken = t
      await AsyncStorage.setItem(TOKEN_KEY, t).catch(() => {})
      return true
    } catch {
      return false
    }
  })
}

/** Sign-out: detach the user from this install (it stays registered as a guest). */
export function detachPushDevice(): Promise<void> {
  return serial(async () => {
    const t = currentToken ?? (await AsyncStorage.getItem(TOKEN_KEY).catch(() => null)) ?? (await deviceToken())
    if (t) await unregisterPushDevice(t).catch(() => {})
  })
}

export async function setDeviceOffersOptIn(on: boolean): Promise<void> {
  await AsyncStorage.setItem(OFFERS_KEY, on ? '1' : '0')
  await syncPushDevice()
}

export interface PushPermission {
  granted: boolean
  /** False once Android won't show the system prompt again; only Settings can turn it on. */
  canAskAgain: boolean
}

export async function getPushPermission(): Promise<PushPermission> {
  const p = await Notifications.getPermissionsAsync()
  return { granted: p.granted, canAskAgain: p.canAskAgain }
}

/** The Android 13 system prompt (it needs a channel to exist first). */
export async function requestPushPermission(): Promise<PushPermission> {
  await initPush()
  const p = await Notifications.requestPermissionsAsync()
  return { granted: p.granted, canAskAgain: p.canAskAgain }
}

export const isBlocked = (p: PushPermission | null | undefined) => !!p && !p.granted && !p.canAskAgain

export async function markSoftAskDeclined(): Promise<void> {
  await AsyncStorage.setItem(DECLINED_KEY, String(Date.now())).catch(() => {})
}

async function coolingDown(): Promise<boolean> {
  const at = Number(await AsyncStorage.getItem(DECLINED_KEY).catch(() => null))
  return !!at && Date.now() - at < COOLDOWN_MS
}

/**
 * Open the soft ask unless push is already on. Automatic triggers also respect the 30-day
 * cooldown and stay quiet when only Settings can help; the settings screen asks explicitly.
 */
export async function maybePromptForPush(reason: PushPromptReason): Promise<void> {
  try {
    const p = await getPushPermission()
    if (p.granted) return
    if (reason !== 'settings' && (!p.canAskAgain || (await coolingDown()))) return
    openPushPrompt(reason)
  } catch {}
}

/** First launch: the soft ask once per install (skipped when push is on or blocked in Settings). */
export async function maybePromptOnFirstLaunch(): Promise<void> {
  try {
    if (await AsyncStorage.getItem(WELCOME_KEY)) return
    await AsyncStorage.setItem(WELCOME_KEY, String(Date.now()))
    await maybePromptForPush('welcome')
  } catch {}
}
