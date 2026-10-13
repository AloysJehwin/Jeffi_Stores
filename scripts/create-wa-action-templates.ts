// Creates a `<slug>_action` copy of every platform WhatsApp template: same body, plus a header image
// (<CDN>/{{n+1}}) and a URL button (<SHORT_LINK_HOST>/{{n+2}}). Only the domains are fixed at Meta
// approval — each send supplies its own image path and short-link code. Campaigns are NOT relinked.
//
//   npx tsx scripts/create-wa-action-templates.ts            # create/update the platform templates
//   npx tsx scripts/create-wa-action-templates.ts --submit   # …and submit each for Meta approval
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'

const PLATFORM = '00000000-0000-0000-0000-000000000000'
const M = (process.env.MESSAGING_URL || 'http://localhost:3101').replace(/\/$/, '')
const CDN = (process.env.CLOUDFRONT_URL || 'https://dm9rri2wgl1e.cloudfront.net').replace(/\/$/, '')
const SHORT = (process.env.SHORT_LINK_BASE || 'https://img.jeffistores.in').replace(/\/$/, '')
const SAMPLE_IMAGE = 'products/1af44a95-cd39-41b7-825e-06b9b06fe607/photo2-allen-cap.jpg'
const SAMPLE_CODE = 'demo'

function secret() {
  if (process.env.SERVICE_AUTH_SECRET) return process.env.SERVICE_AUTH_SECRET
  const env = readFileSync('messaging-service/.env.local', 'utf8')
  return env.match(/^SERVICE_AUTH_SECRET=(.*)$/m)?.[1]?.trim() ?? ''
}
const token = () => {
  const p = JSON.stringify({ service: 'platform', tenantId: PLATFORM, tenantSlug: 'platform', internal: true, space: 'store', exp: Math.floor(Date.now() / 1000) + 300 })
  return `${Buffer.from(p).toString('base64url')}.${createHmac('sha256', secret()).update(p).digest('base64url')}`
}
async function call(method: string, path: string, body?: unknown) {
  const r = await fetch(M + path, { method, headers: { authorization: `Bearer ${token()}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const d: any = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${d?.message ?? d?.error ?? ''}`)
  return d
}

const LABELS: Array<[RegExp, string]> = [
  [/^cart\//, 'View cart'], [/^(promo\/|winback|restock)/, 'Shop now'], [/^order\//, 'View order'],
  [/^invoice\//, 'View invoice'], [/^quotation\//, 'View quotation'], [/^(refund|return)\//, 'View details'],
  [/^feedback\//, 'Share feedback'], [/^support\//, 'View ticket'], [/^kyc\//, 'Open dashboard'],
]
const label = (slug: string) => LABELS.find(([re]) => re.test(slug))?.[1] ?? 'Open'

async function main() {
  const submit = process.argv.includes('--submit')
  const list = (await call('GET', '/v2/templates?channel=whatsapp')).items as any[]
  const bases = list.filter(t => !t.slug.endsWith('_action'))
  for (const base of bases) {
    const full = await call('GET', `/v2/templates/whatsapp/${encodeURIComponent(base.slug)}`)
    const v = full.current_version ?? {}
    if ((full.meta_category ?? '').toUpperCase() === 'AUTHENTICATION') { console.log(`skip ${base.slug} (authentication: no media/links allowed)`); continue }
    const body: string = v.body ?? ''
    const n = Math.max(0, ...[...body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map(m => +m[1]))
    const img = String(n + 1), link = String(n + 2)
    const slug = `${base.slug}_action`
    const saved = await call('POST', '/v2/templates', {
      slug, channel: 'whatsapp', name: `${full.name} (with image + button)`, category: full.category,
      body, blocks_format: 'wa-content', meta_category: full.meta_category ?? 'UTILITY', media_type: 'image', publish: true,
      blocks: {
        variables: { ...(v.blocks?.variables ?? {}), [img]: SAMPLE_IMAGE, [link]: SAMPLE_CODE },
        types: { 'twilio/media': { body, media: [`${CDN}/{{${img}}}`] } },
        buttons: [{ type: 'url', label: label(base.slug), value: `${SHORT}/{{${link}}}` }],
      },
    })
    let status = saved.approval_status ?? 'draft'
    if (submit && !['pending', 'received', 'approved'].includes(status)) {
      try { status = (await call('POST', '/v2/templates/wa/submit-approval', { templateId: saved.id })).approval_status ?? 'submitted' }
      catch (e: any) { status = `submit failed: ${e.message}` }
    }
    console.log(`${slug.padEnd(40)} ${status}`)
  }
}
main().catch(e => { console.error(e); process.exit(1) })
