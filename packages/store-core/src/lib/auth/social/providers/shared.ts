import type { SocialCredentials, SocialProfile } from '../types'

export interface AuthorizeArgs {
  creds: SocialCredentials
  redirectUri: string
  state: string
  /** PKCE S256 challenge; sent by the providers that support it. */
  codeChallenge: string
  /** Bound into the id_token by the providers that issue one. */
  nonce: string
}

export interface ExchangeArgs {
  creds: SocialCredentials
  redirectUri: string
  code: string
  codeVerifier: string
  nonce: string
  /** Apple posts the user's name here on the first authorization only. */
  userField?: string | null
}

export interface SocialProviderModule {
  /** Whether the callback arrives as a cross-site POST (Apple form_post). */
  formPost?: boolean
  authorizeUrl(a: AuthorizeArgs): string
  exchange(a: ExchangeArgs): Promise<SocialProfile>
}

export class SocialProviderError extends Error {}

const TIMEOUT_MS = 10_000

export async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' })
  const text = await res.text()
  let body: any = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {}
  if (!res.ok || !body || body.error) {
    const detail = body?.error_description || body?.error?.message || (typeof body?.error === 'string' ? body.error : '') || `HTTP ${res.status}`
    throw new SocialProviderError(detail)
  }
  return body
}

export const formBody = (o: Record<string, string>) => new URLSearchParams(o).toString()
export const FORM_HEADERS = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }
