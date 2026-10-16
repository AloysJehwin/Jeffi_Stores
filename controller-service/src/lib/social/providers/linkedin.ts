// LinkedIn company pages (Community Management API): posts with an image or article, social
// actions as metrics. No inbox.
import { fetchWithRetry } from '@/lib/channels/ratelimit'
import { SocialApiError, fitText, ownApp, type PostMetrics, type SocialProvider, type TokenSet } from './types'

const LABEL = 'LinkedIn'
const REST = 'https://api.linkedin.com/rest'

/** Escapes little-text reserved characters; '#' stays bare before a word so hashtags still link. */
export function escapeLinkedIn(text: string): string {
  return text.replace(/[|{}@[\]()<>\\*_~]|#(?![\p{L}\p{N}_])/gu, c => `\\${c}`)
}

function headers(token: string, json = false): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'LinkedIn-Version': process.env.LINKEDIN_API_VERSION || '202409',
    'X-Restli-Protocol-Version': '2.0.0',
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  }
}

async function liError(res: Response): Promise<SocialApiError> {
  const body = (await res.json().catch(() => null)) as { message?: string; error_description?: string } | null
  const msg = body?.message ?? body?.error_description ?? `HTTP ${res.status}`
  return new SocialApiError('linkedin', res.status, `${LABEL}: ${msg}`)
}

async function li(url: string, token: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetchWithRetry(url, { ...init, headers: headers(token, !!init.body) })
  if (!res.ok) throw await liError(res)
  return res
}

type App = { clientId: string; clientSecret: string } | null

async function token(form: Record<string, string>, app: App = null): Promise<TokenSet> {
  const clientId = app?.clientId ?? process.env.LINKEDIN_CLIENT_ID ?? ''
  const clientSecret = app?.clientSecret ?? process.env.LINKEDIN_CLIENT_SECRET ?? ''
  const res = await fetchWithRetry('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      ...form,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  })
  if (!res.ok) throw await liError(res)
  const t = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number }
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? form.refresh_token ?? null,
    expiresAt: t.expires_in ? new Date(Date.now() + t.expires_in * 1000).toISOString() : null,
  }
}

async function uploadImage(ownerUrn: string, imageUrl: string, accessToken: string): Promise<string> {
  const init = await li(`${REST}/images?action=initializeUpload`, accessToken, {
    method: 'POST',
    body: JSON.stringify({ initializeUploadRequest: { owner: ownerUrn } }),
  })
  const { value } = (await init.json()) as { value: { uploadUrl: string; image: string } }
  const src = await fetch(imageUrl)
  if (!src.ok) throw new SocialApiError('linkedin', src.status, `${LABEL}: could not download the image`)
  const bytes = await src.arrayBuffer()
  const up = await fetch(value.uploadUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': src.headers.get('content-type') || 'application/octet-stream',
    },
    body: bytes,
  })
  if (!up.ok) throw await liError(up)
  return value.image
}

export const linkedinProvider: SocialProvider = {
  network: 'linkedin',
  label: LABEL,
  limits: { caption: 3000 },
  requires: {},
  oauth: {
    env: ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'],
    authorizeUrl(redirectUri, state) {
      const p = new URLSearchParams({
        response_type: 'code',
        client_id: process.env.LINKEDIN_CLIENT_ID ?? '',
        redirect_uri: redirectUri,
        state,
        scope: 'r_organization_social w_organization_social rw_organization_admin',
      })
      return `https://www.linkedin.com/oauth/v2/authorization?${p}`
    },
    exchange: (code, redirectUri) => token({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
    async refresh(auth) {
      if (!auth.refreshToken) throw new SocialApiError('linkedin', 401, `${LABEL}: no refresh token, sign in again`)
      return token({ grant_type: 'refresh_token', refresh_token: auth.refreshToken }, ownApp(auth))
    },
    async listTargets(t) {
      const res = await li(`${REST}/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED`, t)
      const { elements = [] } = (await res.json()) as { elements?: { organization: string }[] }
      const urns = [...new Set(elements.map(e => e.organization).filter(Boolean))]
      return Promise.all(
        urns.map(async urn => {
          try {
            const org = await li(`${REST}/organizations/${urn.split(':').pop()}`, t)
            const { localizedName } = (await org.json()) as { localizedName?: string }
            return { id: urn, name: localizedName || urn }
          } catch {
            return { id: urn, name: urn }
          }
        })
      )
    },
  },

  async publish(auth, input) {
    const image = input.imageUrls[0]
    const imageUrn = image ? await uploadImage(auth.targetId, image, auth.accessToken) : null
    const content = imageUrn
      ? { media: { id: imageUrn, title: input.title || undefined } }
      : input.link
        ? { article: { source: input.link, title: input.title || 'Shop now' } }
        : undefined
    const body = {
      author: auth.targetId,
      commentary: escapeLinkedIn(fitText(input.caption, 3000)),
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      content,
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    }
    const res = await li(`${REST}/posts`, auth.accessToken, { method: 'POST', body: JSON.stringify(body) })
    const id = res.headers.get('x-restli-id')
    if (!id) throw new SocialApiError('linkedin', 502, `${LABEL}: no post id returned`)
    return { externalId: id, url: `https://www.linkedin.com/feed/update/${id}/` }
  },

  async metrics(auth, ids) {
    const out: Record<string, PostMetrics> = {}
    for (const urn of ids) {
      const res = await li(`${REST}/socialActions/${encodeURIComponent(urn)}`, auth.accessToken)
      const s = (await res.json()) as {
        likesSummary?: { totalLikes?: number }
        commentsSummary?: { aggregatedTotalComments?: number }
      }
      out[urn] = { likes: s.likesSummary?.totalLikes ?? 0, comments: s.commentsSummary?.aggregatedTotalComments ?? 0 }
    }
    return out
  },
}
