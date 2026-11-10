import AsyncStorage from '@react-native-async-storage/async-storage'
import type { UpiMode, UpiPurpose } from '../../types/upi'

// The UPI intent in flight, so an app killed while the browser or a UPI app was open resumes it on relaunch.

const KEY = 'upi_pending_intent'
/** PhonePe intents and UPG sessions (queue aside) end well inside this; older records are stale. */
const TTL_MS = 30 * 60 * 1000

export interface PendingUpi {
  intentId: string
  purpose: UpiPurpose
  mode: UpiMode
  draftToken?: string
  orderId?: string
  amountPaise: number
  /** PhonePe mode's payment page, so it can be reopened. */
  redirectUrl?: string
  /** Checkout from the cart (a Buy Now draft keeps the cart). */
  resetCart: boolean
  startedAt: number
}

export async function savePendingUpi(p: PendingUpi): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(p)).catch(() => {})
}

export async function loadPendingUpi(): Promise<PendingUpi | null> {
  const raw = await AsyncStorage.getItem(KEY).catch(() => null)
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as PendingUpi
    if (!p?.intentId || Date.now() - Number(p.startedAt || 0) > TTL_MS) {
      await clearPendingUpi()
      return null
    }
    return p
  } catch {
    await clearPendingUpi()
    return null
  }
}

export async function clearPendingUpi(): Promise<void> {
  await AsyncStorage.removeItem(KEY).catch(() => {})
}
