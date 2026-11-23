import { after, NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { insertShowcaseLead } from '@/lib/showcase/store'
import { siteForHost } from '@showcase/lib/site'
import { hit } from '@showcase/lib/rate-limit'
import { emailLeadToOwner } from '@showcase/lib/notify'
import { visitForLead, visitorKey } from '@showcase/lib/track'

export const dynamic = 'force-dynamic'

// The site's contact form. The LeadForm part posts ShowcaseLeadInput as JSON and shows an error under the `field` it
// names (`contact`: neither a phone nor an email). A no-script form posts the same fields as a form and is sent back
// to the page: ?lead=sent, or ?lead=error&why=<field|limit>. A filled `website` is the honeypot: it is answered as
// sent and nothing is kept.

const MAX_BODY = 16 * 1024
const PER_SITE = { max: 5, windowSecs: 10 * 60 }
const PER_DAY = { max: 20, windowSecs: 24 * 60 * 60 }

type Why = 'name' | 'phone' | 'email' | 'message' | 'contact' | 'limit'

const field = (max: number, message: string) => z.string().trim().max(max, message).optional().default('')
const Lead = z.object({
  name: z.string().trim().min(1, 'Please enter your name.').max(120, 'Please shorten your name.'),
  phone: field(32, 'Please check the phone number.'),
  email: field(254, 'Please check the email address.'),
  message: field(2000, 'Please shorten your message to 2000 characters.'),
})

const PHONE_RE = /^\+?[\d\s().-]{6,24}$/
// One address with a plain domain: it becomes the owner's reply-to and a mailto: link, so no URL characters (?#%/).
const EMAIL_RE = /^[^\s@<>()",;:?#%/\\]+@(?:[\p{L}\p{N}-]+\.)+[\p{L}\p{N}-]{2,}$/u
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g

function clientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'
}

/** The posted fields; 'large' past MAX_BODY (a chunked body has no content-length to refuse up front). */
async function readBody(req: NextRequest, type: string): Promise<Record<string, unknown> | 'large' | null> {
  const reader = req.body?.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (let r = await reader?.read(); r && !r.done; r = await reader!.read()) {
      size += r.value.byteLength
      if (size > MAX_BODY) {
        reader!.cancel().catch(() => {})
        return 'large'
      }
      chunks.push(r.value)
    }
    const text = Buffer.concat(chunks).toString('utf8')
    if (type.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(text))
    if (type.includes('multipart/form-data')) {
      const fd = await new Response(text, { headers: { 'content-type': type } }).formData()
      return Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'))
    }
    const data = JSON.parse(text)
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  const host = req.headers.get('host') ?? ''
  const type = req.headers.get('content-type') ?? ''
  const form = type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data')
  // A browser posting a plain form expects the page back, not JSON.
  const wantsPage = form && !(req.headers.get('accept') ?? '').includes('application/json')
  const reply = (status: number, body: { ok?: true; error?: string; field?: Exclude<Why, 'limit'> }, extra?: Record<string, string>) => {
    if (!wantsPage || status === 404) return NextResponse.json(body, { status, headers: extra })
    const why: Why | undefined = status === 429 ? 'limit' : body.field
    return new NextResponse(null, { status: 303, headers: { Location: status < 300 ? '/?lead=sent' : `/?lead=error${why ? `&why=${why}` : ''}` } })
  }

  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY) return reply(413, { error: 'That message is too long.' })
  // Only the site's own pages post here: a browser on another site sends that site's origin.
  const origin = req.headers.get('origin')
  if (origin && origin !== 'null') {
    let from = ''
    try {
      from = new URL(origin).host
    } catch {}
    if (from !== host) return reply(403, { error: 'Not allowed.' })
  }

  const site = await siteForHost(host).catch(() => null)
  if (!site || site.status !== 'live' || site.workspaceSuspended) return reply(404, { error: 'This site is not taking enquiries.' })

  const data = await readBody(req, type)
  if (data === 'large') return reply(413, { error: 'That message is too long.' })
  if (!data) return reply(400, { error: 'Please fill in the form.' })
  if (typeof data.website === 'string' && data.website.trim()) return reply(201, { ok: true })
  const parsed = Lead.safeParse(data)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return reply(400, { error: issue?.message || 'Please check the form.', field: issue?.path?.[0] as Exclude<Why, 'limit' | 'contact'> | undefined })
  }

  const clean = (s: string) => s.replace(CONTROL_RE, '')
  const name = clean(parsed.data.name).replace(/[\r\n\t]+/g, ' ').trim()
  const phone = clean(parsed.data.phone)
  const email = clean(parsed.data.email).toLowerCase()
  const message = clean(parsed.data.message)
  if (!name) return reply(400, { error: 'Please enter your name.', field: 'name' })
  if (!phone && !email) return reply(400, { error: 'Please add a phone number or an email so they can reply.', field: 'contact' })
  const digits = phone.replace(/\D/g, '').length
  if (phone && (!PHONE_RE.test(phone) || digits < 6 || digits > 15)) return reply(400, { error: 'Please check the phone number.', field: 'phone' })
  if (email && !EMAIL_RE.test(email)) return reply(400, { error: 'Please check the email address.', field: 'email' })

  const ip = clientIp(req)
  const [perSite, perDay] = await Promise.all([hit(`showcase:lead:${site.id}:${ip}`, PER_SITE.windowSecs), hit(`showcase:lead:${ip}`, PER_DAY.windowSecs)])
  if (perSite > PER_SITE.max || perDay > PER_DAY.max) {
    const retry = perSite > PER_SITE.max ? PER_SITE.windowSecs : PER_DAY.windowSecs
    return reply(429, { error: 'Too many messages. Please try again later.' }, { 'Retry-After': String(retry) })
  }

  // The visit it came from (by the same visitor key the tracker keeps), for the analytics page's lead attribution.
  const sessionId = await visitForLead(site.id, visitorKey(site.id, ip, req.headers.get('user-agent') ?? '')).catch(() => null)
  const saved = await insertShowcaseLead(site.id, { name, phone, email, message, ...(sessionId ? { sessionId } : {}) }).catch(e => {
    console.error('[showcase-leads] insert failed', e?.message || e)
    return null
  })
  if (!saved) return reply(500, { error: 'Your message could not be sent. Please try again.' })
  after(() => emailLeadToOwner(site, saved).catch(e => console.error('[showcase-leads] owner email failed', e?.message || e)))
  return reply(201, { ok: true })
}
