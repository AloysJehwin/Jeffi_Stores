// Google Business Profile: local posts to a location, reviews as the inbox. Also holds the
// Google OAuth helpers YouTube shares.
import { fetchWithRetry } from '@/lib/channels/ratelimit'
import {
  SocialApiError,
  fitText,
  type InboxItem,
  type Network,
  type SocialAuth,
  type SocialProvider,
  type TokenSet,
} from './types'

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token'
const V4 = 'https://mybusiness.googleapis.com/v4'
const GBP_SCOPE = 'https://www.googleapis.com/auth/business.manage'

export const GOOGLE_ENV = ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET']

/** Google error bodies: { error: { message } } or { error, error_description }. */
export async function googleError(network: Network, res: Response, label: string): Promise<SocialApiError> {
  const body = (await res.json().catch(() => null)) as {
    error?: { message?: string } | string
    error_description?: string
  } | null
  const err = body?.error
  const msg =
    (typeof err === 'object' ? err?.message : undefined) ?? body?.error_description ?? (typeof err === 'string' ? err : null)
  return new SocialApiError(network, res.status, `${label}: ${msg ?? `HTTP ${res.status}`}`)
}

export async function googleJson<T>(
  network: Network,
  label: string,
  url: string,
  token: string,
  init: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, ...(init.headers as Record<string, string>) }
  if (init.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json'
  const res = await fetchWithRetry(url, { ...init, headers })
  if (!res.ok) throw await googleError(network, res, label)
  return (res.status === 204 ? {} : await res.json().catch(() => ({}))) as T
}

export function googleAuthorizeUrl(scopes: string[], redirectUri: string, state: string, codeChallenge: string): string {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? '',
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    access_type: 'offline',
    prompt: 'select_account consent',
    include_granted_scopes: 'true',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  })
  return `${GOOGLE_AUTH}?${p}`
}

interface GoogleToken {
  access_token: string
  refresh_token?: string
  expires_in?: number
}

export function expiresAtFrom(expiresIn: number | undefined | null): string | null {
  return expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null
}

async function googleToken(network: Network, label: string, form: Record<string, string>): Promise<GoogleToken> {
  const res = await fetchWithRetry(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '',
      ...form,
    }),
  })
  if (!res.ok) throw await googleError(network, res, label)
  return (await res.json()) as GoogleToken
}

export async function googleExchange(
  network: Network,
  label: string,
  code: string,
  redirectUri: string,
  codeVerifier: string
): Promise<TokenSet> {
  const t = await googleToken(network, label, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  })
  return { accessToken: t.access_token, refreshToken: t.refresh_token ?? null, expiresAt: expiresAtFrom(t.expires_in) }
}

export async function googleRefresh(network: Network, label: string, auth: SocialAuth): Promise<TokenSet> {
  if (!auth.refreshToken) throw new SocialApiError(network, 401, `${label}: no refresh token, sign in again`)
  const t = await googleToken(network, label, { grant_type: 'refresh_token', refresh_token: auth.refreshToken })
  // Google keeps the same refresh token unless it sends a new one.
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? auth.refreshToken,
    expiresAt: expiresAtFrom(t.expires_in),
  }
}

const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 }

/** GBP starRating enum (ONE..FIVE) to 1..5; null when unspecified. */
export function starRating(value: string | null | undefined): number | null {
  return (value && STARS[value]) || null
}

const LABEL = 'Google Business Profile'
const gbp = <T>(url: string, token: string, init?: RequestInit) => googleJson<T>('gbp', LABEL, url, token, init)

interface Review {
  name: string
  reviewer?: { displayName?: string }
  starRating?: string
  comment?: string
  createTime?: string
  reviewReply?: { comment?: string }
}

export const gbpProvider: SocialProvider = {
  network: 'gbp',
  label: LABEL,
  limits: { caption: 1500 },
  requires: {},
  oauth: {
    env: GOOGLE_ENV,
    authorizeUrl: (redirectUri, state, challenge) => googleAuthorizeUrl([GBP_SCOPE], redirectUri, state, challenge),
    exchange: (code, redirectUri, verifier) => googleExchange('gbp', LABEL, code, redirectUri, verifier),
    refresh: auth => googleRefresh('gbp', LABEL, auth),
    async listTargets(token) {
      const accounts = await gbp<{ accounts?: { name: string }[] }>(
        'https://mybusinessaccountmanagement.googleapis.com/v1/accounts',
        token
      )
      const out: { id: string; name: string }[] = []
      for (const account of accounts.accounts ?? []) {
        const locs = await gbp<{ locations?: { name: string; title?: string }[] }>(
          `https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations?readMask=name,title&pageSize=100`,
          token
        )
        for (const l of locs.locations ?? []) out.push({ id: `${account.name}/${l.name}`, name: l.title || l.name })
      }
      return out
    },
  },

  async publish(auth, input) {
    const image = input.imageUrls[0]
    const body = {
      languageCode: 'en-IN',
      summary: fitText(input.caption, 1500),
      topicType: 'STANDARD',
      media: image ? [{ mediaFormat: 'PHOTO', sourceUrl: image }] : undefined,
      callToAction: input.link ? { actionType: 'SHOP', url: input.link } : undefined,
    }
    const res = await gbp<{ name: string; searchUrl?: string }>(`${V4}/${auth.targetId}/localPosts`, auth.accessToken, {
      method: 'POST',
      body: JSON.stringify(body),
    })
    return { externalId: res.name, url: res.searchUrl ?? null }
  },

  async inbox(auth) {
    const res = await gbp<{ reviews?: Review[] }>(`${V4}/${auth.targetId}/reviews?pageSize=50`, auth.accessToken)
    return (res.reviews ?? []).map(
      (r): InboxItem => ({
        externalId: r.name,
        postExternalId: null,
        kind: 'review',
        author: r.reviewer?.displayName ?? null,
        text: r.comment ?? null,
        rating: starRating(r.starRating),
        createdAt: r.createTime ?? null,
        replied: !!r.reviewReply,
      })
    )
  },

  async reply(auth, item, text) {
    if (item.kind !== 'review') throw new SocialApiError('gbp', 400, `${LABEL}: only reviews can be answered`)
    await gbp(`${V4}/${item.externalId}/reply`, auth.accessToken, {
      method: 'PUT',
      body: JSON.stringify({ comment: text }),
    })
  },
}
