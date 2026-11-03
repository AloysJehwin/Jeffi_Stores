// YouTube Shorts: resumable video upload, statistics as metrics, comment threads as the inbox.
import { fetchWithRetry } from '@/lib/channels/ratelimit'
import { GOOGLE_ENV, googleAuthorizeUrl, googleError, googleExchange, googleJson, googleRefresh } from './gbp'
import { SocialApiError, fitText, type InboxItem, type PostMetrics, type SocialProvider } from './types'

const LABEL = 'YouTube Shorts'
const API = 'https://www.googleapis.com/youtube/v3'
const SCOPES = ['youtube.upload', 'youtube.readonly', 'youtube.force-ssl'].map(
  s => `https://www.googleapis.com/auth/${s}`
)
const yt = <T>(url: string, token: string, init?: RequestInit) => googleJson<T>('youtube', LABEL, url, token, init)

/** Title from the post title or the caption's first line, with #Shorts appended when it fits. */
export function shortsTitle(title: string | null | undefined, caption: string): string {
  const base = fitText((title?.trim() || caption.split('\n')[0].trim() || 'New video').trim(), 100)
  return base.length + ' #Shorts'.length <= 100 && !/#shorts/i.test(base) ? `${base} #Shorts` : base
}

export function shortsDescription(caption: string, link: string | null | undefined): string {
  const tail = link ? `\n\n${link}` : ''
  return `${fitText(caption, 5000 - tail.length)}${tail}`
}

const n = (v: string | undefined) => (v == null ? undefined : Number(v))

export const youtubeProvider: SocialProvider = {
  network: 'youtube',
  label: LABEL,
  limits: { caption: 5000, title: 100 },
  requires: { video: true },
  oauth: {
    env: GOOGLE_ENV,
    authorizeUrl: (redirectUri, state, challenge) => googleAuthorizeUrl(SCOPES, redirectUri, state, challenge),
    exchange: (code, redirectUri, verifier) => googleExchange('youtube', LABEL, code, redirectUri, verifier),
    refresh: auth => googleRefresh('youtube', LABEL, auth),
    async listTargets(token) {
      const res = await yt<{ items?: { id: string; snippet?: { title?: string } }[] }>(
        `${API}/channels?part=snippet&mine=true`,
        token
      )
      return (res.items ?? []).map(c => ({ id: c.id, name: c.snippet?.title || c.id }))
    },
  },

  async publish(auth, input) {
    if (!input.videoUrl) throw new SocialApiError('youtube', 400, `${LABEL}: a video is required`)
    const src = await fetch(input.videoUrl)
    if (!src.ok) throw new SocialApiError('youtube', src.status, `${LABEL}: could not download the video`)
    const type = src.headers.get('content-type') || 'video/mp4'
    const bytes = await src.arrayBuffer()

    const meta = {
      snippet: {
        title: shortsTitle(input.title, input.caption),
        description: shortsDescription(input.caption, input.link),
        categoryId: '22',
      },
      status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
    }
    const start = await fetchWithRetry(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': type,
          'X-Upload-Content-Length': String(bytes.byteLength),
        },
        body: JSON.stringify(meta),
      }
    )
    if (!start.ok) throw await googleError('youtube', start, LABEL)
    const location = start.headers.get('location')
    if (!location) throw new SocialApiError('youtube', 502, `${LABEL}: no upload URL returned`)

    const up = await fetch(location, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${auth.accessToken}`, 'Content-Type': type },
      body: bytes,
    })
    if (!up.ok) throw await googleError('youtube', up, LABEL)
    const video = (await up.json()) as { id: string }
    return { externalId: video.id, url: `https://www.youtube.com/shorts/${video.id}` }
  },

  async metrics(auth, ids) {
    const out: Record<string, PostMetrics> = {}
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50)
      const res = await yt<{
        items?: { id: string; statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } }[]
      }>(`${API}/videos?part=statistics&id=${batch.map(encodeURIComponent).join(',')}`, auth.accessToken)
      for (const v of res.items ?? []) {
        const s = v.statistics ?? {}
        out[v.id] = { videoViews: n(s.viewCount), likes: n(s.likeCount), comments: n(s.commentCount) }
      }
    }
    return out
  },

  async inbox(auth, ids) {
    const items: InboxItem[] = []
    for (const id of ids) {
      const res = await yt<{
        items?: {
          snippet: {
            totalReplyCount?: number
            topLevelComment: {
              id: string
              snippet: { authorDisplayName?: string; textOriginal?: string; publishedAt?: string }
            }
          }
        }[]
      }>(`${API}/commentThreads?part=snippet&videoId=${encodeURIComponent(id)}&maxResults=50`, auth.accessToken)
      for (const t of res.items ?? []) {
        const c = t.snippet.topLevelComment
        items.push({
          externalId: c.id,
          postExternalId: id,
          kind: 'comment',
          author: c.snippet.authorDisplayName ?? null,
          text: c.snippet.textOriginal ?? null,
          createdAt: c.snippet.publishedAt ?? null,
          replied: (t.snippet.totalReplyCount ?? 0) > 0,
        })
      }
    }
    return items
  },

  async reply(auth, item, text) {
    await yt(`${API}/comments?part=snippet`, auth.accessToken, {
      method: 'POST',
      body: JSON.stringify({ snippet: { parentId: item.externalId, textOriginal: text } }),
    })
  },
}
