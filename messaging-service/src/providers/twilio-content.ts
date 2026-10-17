// Twilio Content API client — create WA content templates, submit for Meta approval, fetch status.
// Docs: https://www.twilio.com/docs/content

const BASE = 'https://content.twilio.com/v1'

function auth(): string {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const tok = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !tok) throw new Error('TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN missing')
  return 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64')
}

async function call<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: auth(),
      'Content-Type': body ? 'application/json' : 'application/x-www-form-urlencoded',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await r.text()
  const json = text ? JSON.parse(text) : {}
  if (!r.ok) {
    const err: any = new Error(json?.message || `Twilio Content ${r.status}`)
    err.status = r.status; err.code = json?.code; err.body = json
    throw err
  }
  return json as T
}

export interface ContentCreateInput {
  friendly_name: string
  language: string                 // e.g. 'en', 'en_US', 'hi'
  variables?: Record<string, string>
  types: Record<string, any>       // { 'twilio/text': {...}, 'twilio/card': {...}, etc. }
}
export interface ContentResource {
  sid: string
  friendly_name: string
  language: string
  variables: Record<string, string>
  types: Record<string, any>
  date_created: string
  date_updated: string
}

export const createContent = (i: ContentCreateInput) =>
  call<ContentResource>('POST', '/Content', i)

export const getContent = (sid: string) =>
  call<ContentResource>('GET', `/Content/${sid}`)

export const deleteContent = (sid: string) =>
  call<Record<string, never>>('DELETE', `/Content/${sid}`)

export interface ApprovalCreateInput {
  name: string                                             // template name as submitted to Meta (snake_case)
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'
  allow_category_change?: boolean
}
export interface ApprovalResource {
  name: string
  category: string
  status: string                                           // received|pending|approved|rejected|paused|disabled
  rejection_reason?: string
  content_type?: string
  allow_category_change?: boolean
}

export const submitForApproval = (sid: string, i: ApprovalCreateInput) =>
  call<ApprovalResource>('POST', `/Content/${sid}/ApprovalRequests/whatsapp`, i)

export const getApprovalStatus = (sid: string) =>
  call<{ sid: string; account_sid: string; whatsapp: ApprovalResource }>('GET', `/Content/${sid}/ApprovalRequests`)

/** Map Twilio verbatim status → our enum. Anything unknown → 'pending'. */
export function mapApprovalStatus(raw: string | undefined | null): string {
  const s = (raw || '').toLowerCase()
  if (['approved', 'rejected', 'paused', 'disabled', 'pending', 'received', 'unsubmitted'].includes(s)) return s
  if (s === 'in_appeal' || s === 'in review') return 'pending'
  return 'pending'
}
