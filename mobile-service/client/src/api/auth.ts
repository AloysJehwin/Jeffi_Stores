import { api, APP_USER_AGENT, BASE_URL, getAuthPortal } from './client'
import type { User } from '../types'

export async function sendOtp(email: string): Promise<void> {
  await api('/api/auth/send-otp', {
    method: 'POST',
    body: JSON.stringify({ email }),
    token: null,
  })
}

export async function loginWithOtp(
  email: string,
  otp: string,
  opts: { policiesAccepted?: boolean; channel?: OtpChannel } = {}
): Promise<{ token: string; user: User | null; isNewUser?: boolean }> {
  const data = await api<{ message?: string; user?: User; token?: string; isNewUser?: boolean; email?: string }>(
    '/api/auth/login',
    { method: 'POST', body: JSON.stringify({ email, otp, ...opts }), token: null }
  )
  return {
    token: data.token || '',
    user: data.user || null,
    isNewUser: data.isNewUser,
  }
}

export async function signup(payload: {
  email: string
  firstName: string
  lastName?: string
  phone?: string
  otp?: string
  dateOfBirth?: string
  channel?: OtpChannel
}): Promise<{ token: string; user: User }> {
  const data = await api<{ token?: string; user: User }>('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify(payload),
    token: null,
  })
  return { token: data.token || '', user: data.user }
}

/** The signed-in user; a business session reads /api/business/me (approval status, company, discounts). */
export async function getMe(): Promise<User | null> {
  const data = await api<{ user: User | null }>(getAuthPortal() === 'business' ? '/api/business/me' : '/api/auth/me')
  return data.user
}

export async function logout(): Promise<void> {
  await api(getAuthPortal() === 'business' ? '/api/business/logout' : '/api/auth/logout', { method: 'POST' }).catch(() => {})
}

// ── The web's login/signup flow (channel choice, cooldowns, policy acceptance) ──

export type OtpChannel = 'email' | 'sms' | 'whatsapp'

/** An unauthenticated POST that keeps the status and body when it fails. */
async function authPost<T>(path: string, body: unknown): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': APP_USER_AGENT },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

export interface SendOtpResult {
  resolvedEmail?: string
  nextCooldown?: number
  retryAfter?: number
  requiresPolicyAcceptance?: boolean
  userNotFound?: boolean
  userExists?: boolean
}

/** POST /api/auth/send-otp as the web's login and signup pages send it. */
export function requestOtp(body: {
  identifier?: string
  email?: string
  phone?: string
  channel: OtpChannel
  isSignup: boolean
  userType?: 'business'
}) {
  return authPost<SendOtpResult>('/api/auth/send-otp', body)
}

export function verifyEmailOtp(email: string, otp: string) {
  return authPost<{ valid?: boolean }>('/api/auth/verify-otp', { email, otp })
}

// ── Google ──

export const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || ''

export type GoogleAuthResult =
  | { newUser: true; profile: { email: string; firstName: string; lastName: string }; token?: undefined; user?: undefined }
  | { newUser?: false; token: string; user: User & { phoneVerified?: boolean; dateOfBirth?: string | null; requiresPolicyAcceptance?: boolean } }

export async function googleAuth(idToken: string): Promise<GoogleAuthResult> {
  const data = await api<any>('/api/auth/google', {
    method: 'POST',
    body: JSON.stringify({ idToken }),
    token: null,
  })
  if (data.newUser) return { newUser: true, profile: data.profile }
  return { newUser: false, token: data.token || '', user: data.user }
}

export async function googleComplete(payload: {
  idToken: string
  firstName: string
  lastName?: string
  phone: string
  dateOfBirth: string
}): Promise<{ token: string; user: User }> {
  const data = await api<{ token?: string; user: User }>('/api/auth/google/complete', {
    method: 'POST',
    body: JSON.stringify(payload),
    token: null,
  })
  return { token: data.token || '', user: data.user }
}

/** Native Google sign-in; returns the id token, or null when the user backs out. */
export async function googleSignInIdToken(): Promise<string | null> {
  const { GoogleSignin, statusCodes } = await import('@react-native-google-signin/google-signin')
  GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID })
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true })
    // Always offer the account picker, like the web popup.
    await GoogleSignin.signOut().catch(() => null)
    const res = await GoogleSignin.signIn()
    if (res.type !== 'success') return null
    if (!res.data.idToken) throw new Error('Google sign-in failed')
    return res.data.idToken
  } catch (err: any) {
    if (err?.code === statusCodes.SIGN_IN_CANCELLED || err?.code === statusCodes.IN_PROGRESS) return null
    // Setup problems (no Android OAuth client for this package/SHA-1 → DEVELOPER_ERROR, code 10; no Play
    // Services) are ours to fix, not the customer's: point them at the other ways in.
    const code = String(err?.code ?? '')
    if (code === '10' || code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE || /DEVELOPER_ERROR/.test(String(err?.message ?? '')))
      throw new Error("Google sign-in isn't available right now — use your mobile number or email instead.")
    throw err
  }
}
