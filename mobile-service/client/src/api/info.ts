import { APP_USER_AGENT, BASE_URL, api, authHeaders } from './client'
import type { SupportMessage, SupportSession, SupportUpload } from '../types/support'

// Info pages: About categories, legal policies, and the support chat (same /api routes the web uses).

export interface OfferCategory {
  id: string
  name: string
  slug: string | null
  icon_name: string | null
  subcategories: Array<{ id: string; name: string; slug: string | null }>
}

export function getAboutCategories(): Promise<OfferCategory[]> {
  return api<{ categories: OfferCategory[] }>('/api/about', { token: null }).then(d => d.categories)
}

export interface PolicySummary {
  slug: string
  title: string
  description: string
  lastUpdated: string
}
export interface Policy extends PolicySummary {
  sections: Array<{ heading: string; body: string | string[] }>
}

export function listPolicies(): Promise<PolicySummary[]> {
  return api<{ policies: PolicySummary[] }>('/api/legal', { token: null }).then(d => d.policies)
}

export function getPolicy(slug: string): Promise<Policy> {
  return api<{ policy: Policy }>(`/api/legal/${encodeURIComponent(slug)}`, { token: null }).then(d => d.policy)
}

// ── Support chat (Support 2.0: controller-service lib/support; ?v=2 asks for the new shapes) ──

const S = '/api/support/sessions'
const post = (body?: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body ?? {}) })

export function getOpenSupportSession(): Promise<{ session: SupportSession | null }> {
  return api(`${S}?v=2`)
}

/** Opens a chat (or returns the open one); the assistant answers first. */
export function startSupportSession(lang: string | null): Promise<{ session: SupportSession }> {
  return api(`${S}?v=2`, post({ lang }))
}

export function getSupportSession(id: string): Promise<{ session: SupportSession }> {
  return api(`${S}/${id}?v=2`)
}

export function closeSupportSession(id: string): Promise<{ success: boolean }> {
  return api(`${S}/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'closed' }) })
}

export function listSupportMessages(id: string, after?: string | null): Promise<{ messages: SupportMessage[]; session?: SupportSession }> {
  return api(`${S}/${id}/messages?v=2${after ? `&after=${encodeURIComponent(after)}` : ''}`)
}

/** Idempotent on clientId: a retry with the same one never posts twice. */
export function postSupportMessage(id: string, body: { message: string; clientId: string; attachmentIds?: string[] }): Promise<{ message: SupportMessage }> {
  return api(`${S}/${id}/messages?v=2`, post(body))
}

export function sendSupportReceipt(id: string, state: 'delivered' | 'read', upTo: string) {
  return api(`${S}/${id}/receipts`, post({ state, upTo }))
}

export function sendSupportTyping(id: string, on: boolean) {
  return api(`${S}/${id}/typing`, post({ on }))
}

export function sendSupportHeartbeat(id: string, leaving = false) {
  return api(`${S}/${id}/heartbeat`, post(leaving ? { leaving: true } : {}))
}

export function setSupportLanguage(id: string, lang: string) {
  return api(`${S}/${id}/language`, post({ lang }))
}

export function decideSupportAction(id: string, actionId: string, decision: 'confirm' | 'decline'): Promise<{ ok: boolean; status: string }> {
  return api(`${S}/${id}/actions/${actionId}`, post({ decision }))
}

export const SUPPORT_MAX_BYTES = 25 * 1024 * 1024

/** Multipart upload with progress (XHR: fetch has no upload progress). */
export async function uploadSupportAttachment(
  id: string,
  file: { uri: string; name: string; type: string },
  onProgress: (pct: number) => void
): Promise<SupportUpload> {
  const headers = { 'User-Agent': APP_USER_AGENT, ...(await authHeaders()) }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${BASE_URL}${S}/${id}/attachments`)
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v)
    xhr.upload.onprogress = e => {
      if (e.lengthComputable && e.total > 0) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => {
      let d: { attachment?: SupportUpload; error?: string } = {}
      try {
        d = JSON.parse(xhr.responseText)
      } catch {
        /* not json */
      }
      if (xhr.status >= 200 && xhr.status < 300 && d.attachment) resolve(d.attachment)
      else reject(new Error(d.error || (xhr.status === 413 ? 'Files can be up to 25 MB' : 'Upload failed')))
    }
    xhr.onerror = () => reject(new Error('Upload failed'))
    const fd = new FormData()
    fd.append('file', { uri: file.uri, name: file.name, type: file.type } as unknown as Blob)
    xhr.send(fd)
  })
}

/** The live event stream (SSE) and the headers it needs. */
export async function supportStream(id: string): Promise<{ url: string; headers: Record<string, string> }> {
  return { url: `${BASE_URL}${S}/${id}/stream`, headers: await supportFileHeaders() }
}

/** Attachment routes (/api/support/attachments/:id) are relative and need the session. */
export const supportFileUrl = (url: string) => (url.startsWith('/') ? `${BASE_URL}${url}` : url)

export async function supportFileHeaders(): Promise<Record<string, string>> {
  return { 'User-Agent': APP_USER_AGENT, ...(await authHeaders()) }
}

/**
 * The short-lived signed URL behind an attachment route, for handing a file to the browser or a
 * player (they can't send the bearer). Redirects drop the Authorization header, so HEAD is enough.
 */
export async function resolveSupportFile(url: string): Promise<string> {
  if (!url.startsWith('/')) return url
  const src = supportFileUrl(url)
  const res = await fetch(src, { method: 'HEAD', headers: await supportFileHeaders() })
  if (res.status === 401 || res.status === 404 || !res.url || res.url === src) throw new Error('Could not open the file')
  return res.url
}
