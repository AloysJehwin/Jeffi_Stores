// X (API v2): posts with an optional image, public metrics. OAuth 2.0 with PKCE; X rotates
// the refresh token on every refresh. No inbox.
import { fetchWithRetry } from '@/lib/channels/ratelimit'
import { SocialApiError, fitText, type PostMetrics, type SocialProvider, type TokenSet } from './types'

const LABEL = 'X'
const API = 'https://api.x.com/2'
const MAX = 280
/** X counts every URL as 23 characters. */
const URL_WEIGHT = 23

/** Caption cut so caption + ' ' + link stays within 280 (link weighted as 23). */
export function xText(caption: string, link?: string | null): string {
  if (!link) return fitText(caption.trim(), MAX)
  const body = fitText(caption.trim(), MAX - URL_WEIGHT - 1)
  return body ? `${body} ${link}` : link
}

async function xError(res: Response): Promise<SocialApiError> {
  const body = (await res.json().catch(() => null)) as {
    detail?: string
    title?: string
    errors?: { message?: string }[]
    error_description?: string
  } | null
  const msg = body?.detail ?? body?.errors?.[0]?.message ?? body?.error_description ?? body?.title ?? `HTTP ${res.status}`
  return new SocialApiError('x', res.status, `${LABEL}: ${msg}`)
}

async function x<T>(url: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await fetchWithRetry(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
    },
  })
  if (!res.ok) throw await xError(res)
  return (await res.json()) as T
}

async function token(form: Record<string, string>): Promise<TokenSet> {
  const basic = Buffer.from(`${process.env.X_CLIENT_ID ?? ''}:${process.env.X_CLIENT_SECRET ?? ''}`).toString('base64')
  const res = await fetchWithRetry(`${API}/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...form, client_id: process.env.X_CLIENT_ID ?? '' }),
  })
  if (!res.ok) throw await xError(res)
  const t = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number }
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? null,
    expiresAt: t.expires_in ? new Date(Date.now() + t.expires_in * 1000).toISOString() : null,
  }
}

async function uploadImage(imageUrl: string, accessToken: string): Promise<string> {
  const src = await fetch(imageUrl)
  if (!src.ok) throw new SocialApiError('x', src.status, `${LABEL}: could not download the image`)
  const type = src.headers.get('content-type') || 'image/jpeg'
  const form = new FormData()
  form.append('media', new Blob([await src.arrayBuffer()], { type }), 'image')
  form.append('media_category', 'tweet_image')
  const res = await x<{ data?: { id?: string; media_id_string?: string }; media_id_string?: string }>(
    `${API}/media/upload`,
    accessToken,
    { method: 'POST', body: form }
  )
  const id = res.data?.id ?? res.data?.media_id_string ?? res.media_id_string
  if (!id) throw new SocialApiError('x', 502, `${LABEL}: no media id returned`)
  return id
}

export const xProvider: SocialProvider = {
  network: 'x',
  label: LABEL,
  limits: { caption: MAX },
  requires: {},
  oauth: {
    env: ['X_CLIENT_ID', 'X_CLIENT_SECRET'],
    authorizeUrl(redirectUri, state, codeChallenge) {
      const p = new URLSearchParams({
        response_type: 'code',
        client_id: process.env.X_CLIENT_ID ?? '',
        redirect_uri: redirectUri,
        scope: 'tweet.read tweet.write users.read media.write offline.access',
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      })
      return `https://x.com/i/oauth2/authorize?${p}`
    },
    exchange: (code, redirectUri, verifier) =>
      token({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier }),
    async refresh(auth) {
      if (!auth.refreshToken) throw new SocialApiError('x', 401, `${LABEL}: no refresh token, sign in again`)
      return token({ grant_type: 'refresh_token', refresh_token: auth.refreshToken })
    },
    async listTargets(t) {
      const res = await x<{ data: { id: string; username: string } }>(`${API}/users/me`, t)
      return [{ id: res.data.id, name: `@${res.data.username}` }]
    },
  },

  async publish(auth, input) {
    const image = input.imageUrls[0]
    const mediaId = image ? await uploadImage(image, auth.accessToken) : null
    const body = { text: xText(input.caption, input.link), ...(mediaId ? { media: { media_ids: [mediaId] } } : {}) }
    const res = await x<{ data: { id: string } }>(`${API}/tweets`, auth.accessToken, {
      method: 'POST',
      body: JSON.stringify(body),
    })
    return { externalId: res.data.id, url: `https://x.com/i/web/status/${res.data.id}` }
  },

  async metrics(auth, ids) {
    const out: Record<string, PostMetrics> = {}
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100)
      const res = await x<{
        data?: {
          id: string
          public_metrics?: {
            like_count?: number
            retweet_count?: number
            quote_count?: number
            reply_count?: number
            impression_count?: number
          }
        }[]
      }>(`${API}/tweets?ids=${batch.join(',')}&tweet.fields=public_metrics`, auth.accessToken)
      for (const t of res.data ?? []) {
        const m = t.public_metrics ?? {}
        out[t.id] = {
          likes: m.like_count ?? 0,
          shares: (m.retweet_count ?? 0) + (m.quote_count ?? 0),
          comments: m.reply_count ?? 0,
          impressions: m.impression_count ?? 0,
        }
      }
    }
    return out
  },
}
