import { Platform } from 'react-native'
import Constants from 'expo-constants'
import * as SecureStore from 'expo-secure-store'

// The mobile backend (mobile-service pod). Override for a local run: EXPO_PUBLIC_API_URL=http://<mac-ip>:3103
export const BASE_URL = (process.env.EXPO_PUBLIC_API_URL || 'https://mobile.jeffistores.in').replace(/\/$/, '')

// Names the app and its OS in sessions and logs, instead of the bare okhttp/CFNetwork agent.
export const APP_USER_AGENT = `JeffiStoresApp/${Constants.expoConfig?.version ?? '0'} (${Platform.OS === 'ios' ? 'iOS' : 'Android'} ${Platform.Version})`

const TOKEN_KEY = 'auth_token'
const PORTAL_KEY = 'auth_portal'

export async function getStoredToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY)
}

export async function storeToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token)
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY)
}

/** Which account the stored session belongs to: a customer, or a business (a separate account, as on the web). */
export type AuthPortal = 'customer' | 'business'
let portal: AuthPortal = 'customer'

export const getAuthPortal = () => portal

export async function loadAuthPortal(): Promise<AuthPortal> {
  portal = (await SecureStore.getItemAsync(PORTAL_KEY)) === 'business' ? 'business' : 'customer'
  return portal
}

export async function setAuthPortal(next: AuthPortal): Promise<void> {
  portal = next
  if (next === 'business') await SecureStore.setItemAsync(PORTAL_KEY, next)
  else await SecureStore.deleteItemAsync(PORTAL_KEY)
}

/** Bearer for the stored session; a business session also names its portal, as the web's business pages do. */
export async function authHeaders(token?: string | null): Promise<Record<string, string>> {
  const t = token !== undefined ? token : await getStoredToken()
  if (!t) return {}
  return portal === 'business' ? { Authorization: `Bearer ${t}`, 'X-Auth-Portal': 'business' } : { Authorization: `Bearer ${t}` }
}

export async function api<T>(
  path: string,
  options: RequestInit & { token?: string | null } = {}
): Promise<T> {
  const { token, ...rest } = options

  const res = await fetch(`${BASE_URL}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': APP_USER_AGENT,
      // This build sizes its own images (useImageSource); older ones get them sized by mobile-service.
      'X-Jeffi-Image-Sizing': 'client',
      ...(await authHeaders(token)),
      ...(rest.headers as Record<string, string> | undefined),
    },
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as any).error || `HTTP ${res.status}`)
  }

  return res.json()
}
