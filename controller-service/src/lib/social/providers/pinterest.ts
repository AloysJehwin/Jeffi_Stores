// Pinterest API v5: image pins to a board, pin analytics as metrics. No inbox.
import { fetchWithRetry } from '@/lib/channels/ratelimit'
import { SocialApiError, fitText, type PostMetrics, type SocialProvider, type TokenSet } from './types'

const LABEL = 'Pinterest'
const API = 'https://api.pinterest.com/v5'

async function pinError(res: Response): Promise<SocialApiError> {
  const body = (await res.json().catch(() => null)) as { message?: string; error_description?: string } | null
  const msg = body?.message ?? body?.error_description ?? `HTTP ${res.status}`
  return new SocialApiError('pinterest', res.status, `${LABEL}: ${msg}`)
}

async function pin<T>(url: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await fetchWithRetry(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers as Record<string, string>),
    },
  })
  if (!res.ok) throw await pinError(res)
  return (await res.json()) as T
}

async function token(form: Record<string, string>): Promise<TokenSet> {
  const basic = Buffer.from(`${process.env.PINTEREST_APP_ID ?? ''}:${process.env.PINTEREST_APP_SECRET ?? ''}`).toString(
    'base64'
  )
  const res = await fetchWithRetry(`${API}/oauth/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
  })
  if (!res.ok) throw await pinError(res)
  const t = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number }
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? form.refresh_token ?? null,
    expiresAt: t.expires_in ? new Date(Date.now() + t.expires_in * 1000).toISOString() : null,
  }
}

const ymd = (d: Date) => d.toISOString().slice(0, 10)

/** Pin analytics `all` block to metrics, from summary_metrics or summed daily_metrics. */
export function pinMetrics(all: {
  summary_metrics?: Record<string, number>
  daily_metrics?: { metrics?: Record<string, number> }[]
} | undefined): PostMetrics {
  let m = all?.summary_metrics
  if (!m) {
    m = {}
    for (const d of all?.daily_metrics ?? [])
      for (const [k, v] of Object.entries(d.metrics ?? {})) m[k] = (m[k] ?? 0) + (Number(v) || 0)
  }
  return {
    impressions: m.IMPRESSION ?? 0,
    saves: m.SAVE ?? 0,
    clicks: (m.OUTBOUND_CLICK ?? 0) + (m.PIN_CLICK ?? 0),
  }
}

export const pinterestProvider: SocialProvider = {
  network: 'pinterest',
  label: LABEL,
  limits: { caption: 500, title: 100 },
  requires: { image: true },
  oauth: {
    env: ['PINTEREST_APP_ID', 'PINTEREST_APP_SECRET'],
    authorizeUrl(redirectUri, state) {
      const p = new URLSearchParams({
        client_id: process.env.PINTEREST_APP_ID ?? '',
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'boards:read,pins:read,pins:write,user_accounts:read',
        state,
      })
      return `https://www.pinterest.com/oauth/?${p}`
    },
    exchange: (code, redirectUri) => token({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
    async refresh(auth) {
      if (!auth.refreshToken) throw new SocialApiError('pinterest', 401, `${LABEL}: no refresh token, sign in again`)
      return token({ grant_type: 'refresh_token', refresh_token: auth.refreshToken })
    },
    async listTargets(t) {
      const res = await pin<{ items?: { id: string; name: string }[] }>(`${API}/boards?page_size=100`, t)
      return (res.items ?? []).map(b => ({ id: b.id, name: b.name }))
    },
  },

  async publish(auth, input) {
    const image = input.imageUrls[0]
    if (!image) throw new SocialApiError('pinterest', 400, `${LABEL}: an image is required`)
    const body = {
      board_id: auth.targetId,
      title: fitText(input.title?.trim() || input.caption.split('\n')[0].trim(), 100),
      description: fitText(input.caption, 500),
      link: input.link || undefined,
      alt_text: input.title ? fitText(input.title, 500) : undefined,
      media_source: { source_type: 'image_url', url: image },
    }
    const res = await pin<{ id: string }>(`${API}/pins`, auth.accessToken, { method: 'POST', body: JSON.stringify(body) })
    return { externalId: res.id, url: `https://www.pinterest.com/pin/${res.id}/` }
  },

  async metrics(auth, ids) {
    const end = new Date()
    const start = new Date(end.getTime() - 29 * 86_400_000)
    const out: Record<string, PostMetrics> = {}
    for (const id of ids) {
      const q = new URLSearchParams({
        start_date: ymd(start),
        end_date: ymd(end),
        metric_types: 'IMPRESSION,SAVE,PIN_CLICK,OUTBOUND_CLICK',
      })
      const res = await pin<{ all?: Parameters<typeof pinMetrics>[0] }>(
        `${API}/pins/${encodeURIComponent(id)}/analytics?${q}`,
        auth.accessToken
      )
      out[id] = pinMetrics(res.all)
    }
    return out
  },
}
