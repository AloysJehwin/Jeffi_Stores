import { describe, it, expect, vi, beforeEach } from 'vitest'

process.env.SERVICE_AUTH_SECRET = 'test-secret'
process.env.MESSAGING_DATABASE_URL = 'postgres://x'
process.env.SHORT_LINK_BASE = 'https://img.test'

const dbRows = { short_link: [] as any[], messages: [] as any[] }
vi.mock('../src/db.js', () => ({
  db: { query: vi.fn(async (sql: string, params: any[] = []) => {
    if (sql.includes('FROM short_link WHERE code')) return { rows: dbRows.short_link.filter(r => r.code === params[0]), rowCount: 0 }
    if (sql.includes('INSERT INTO short_link')) { dbRows.short_link.push({ code: params[0], destination_url: params[3] ?? params[2] }); return { rows: [], rowCount: 1 } }
    if (sql.includes('FROM messages WHERE id = ANY')) return { rows: dbRows.messages, rowCount: dbRows.messages.length }
    if (sql.includes('FROM messages WHERE tenant_id')) return { rows: dbRows.messages, rowCount: dbRows.messages.length }
    return { rows: [], rowCount: 1 }
  }) },
  one: vi.fn(async () => undefined),
}))
vi.mock('@jeffi/wallet', () => ({ debit: vi.fn(async () => ({ ok: true, charged: true, balance: 100 })), trueUp: vi.fn() }))
vi.mock('@jeffi/push', () => ({ sendPush: vi.fn(async () => []) }))
vi.mock('../src/send.js', () => ({
  sendMessage: vi.fn(async () => ({ id: 'm1', status: 'sent', error: null, charged_inr: '0.5' })),
  getMessage: vi.fn(async () => undefined),
  resolveTemplate: vi.fn(async () => ({ body: 'x' })),
  systemVars: vi.fn(async () => ({ store_name: 'S' })),
  assertChannelOn: vi.fn(async () => {}),
  toApi: (m: any) => m,
  SendError: class SendError extends Error { constructor(public status: number, public code: string, msg: string, public details?: unknown) { super(msg) } },
}))
vi.mock('../src/templates.js', () => ({ listTemplates: vi.fn(async () => [{ id: 't', slug: 's' }]), upsertTemplate: vi.fn(async () => ({ id: 't' })), archiveTemplate: vi.fn(async () => 1), toApi: (t: any) => t }))
vi.mock('../src/templates-v2.js', async orig => ({
  ...(await orig<any>()),
  findBySlugWithDefaults: vi.fn(), findPlatformBySlug: vi.fn(), findBySlug: vi.fn(), findById: vi.fn(),
  listTemplatesWithDefaults: vi.fn(async () => [{ slug: 's', channel: 'email', source: 'platform' }]),
  listVersions: vi.fn(async () => []), upsertTemplate: vi.fn(async () => ({ template: { id: 't' }, variant: { id: 'v' }, family: { slug: 's' } })),
  publishVersion: vi.fn(async () => true), archiveTemplate: vi.fn(async () => true), setApprovalStatus: vi.fn(),
  toApi: (t: any) => ({ api: true, id: t?.template?.id }),
}))
vi.mock('../src/governance.js', () => ({
  getSettings: vi.fn(async () => ({ standard_templates: 'all', allowed: [], editing_enabled: true, review_required: false })),
  putSettings: vi.fn(async (_t: string, s: any) => s), standardAllowed: () => true, assertCanEdit: vi.fn(),
  markReview: vi.fn(), reviewDecision: vi.fn(async () => true), reviewQueue: vi.fn(async () => [{ id: 'q1' }]),
}))
vi.mock('../src/wa-approval.js', () => ({ submit: vi.fn(async () => ({ sid: 'HX', name: 'n', status: 'pending' })), syncTenant: vi.fn(async () => ({ checked: 1, changed: 0 })), startApprovalSync: vi.fn() }))
vi.mock('../src/delivery.js', () => ({ applyStatus: vi.fn(), startDeliverySync: vi.fn() }))
vi.mock('../src/pools.js', () => ({ poolsForTenant: vi.fn(async () => ({ pool: { query: vi.fn() }, pools: { tenant: {}, platform: {} } })) }))
vi.mock('../src/media.js', () => ({ hostUrl: vi.fn(async () => ({ url: 'https://cdn/x.jpg', fresh: true })), hostMedia: vi.fn(async () => ({ url: 'https://cdn/y.jpg' })), MediaError: class extends Error { constructor(public status: number, public code: string, m: string) { super(m) } } }))
vi.mock('@jeffi/tenancy', async orig => ({ ...(await orig<any>()), resolveServiceScope: vi.fn(async () => ({ tenantId: null, skipStoreTenants: false })), inScope: () => true, verifyLink: vi.fn(() => null), scopeSql: () => ({ sql: 'true', params: [] }), poolsForTenant: vi.fn() }))
vi.mock('@jeffi/bulk', () => ({
  createJob: vi.fn(async () => ({ id: 'job1' })), getJob: vi.fn(async () => ({ id: 'job1' })),
  listJobs: vi.fn(async () => ({ items: [] })), listItems: vi.fn(async () => ({ rows: [], next_cursor: null })),
  cancelJob: vi.fn(async (_d, j) => j), retryJob: vi.fn(async (_d, j) => j), jobToApi: (j: any) => j,
  startWorker: vi.fn(), BulkItemError: class extends Error {},
}))

import { signServiceToken } from '@jeffi/service-auth'
import { app } from '../src/server'
import * as send from '../src/send'
import * as tplv2 from '../src/templates-v2'
import * as tplv1 from '../src/templates'
import * as gov from '../src/governance'
import * as wa from '../src/wa-approval'

const auth = (claims = {}) => ({ authorization: `Bearer ${signServiceToken({ service: 'gateway', tenantId: 't1', ...claims })}` })
const api = (claims = {}) => auth({ service: 'public-api', ...claims })

describe('server routes', () => {
  beforeEach(() => { dbRows.short_link = []; dbRows.messages = []; vi.clearAllMocks()
    vi.mocked(send.sendMessage).mockResolvedValue({ id: 'm1', status: 'sent', error: null, charged_inr: '0.5' } as any)
  })

  it('POST /messages validates the body and sends', async () => {
    const res = await app.inject({ method: 'POST', url: '/messages', headers: auth(), payload: { channel: 'sms', to: '+919999999999', body: 'hi' } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ status: 'sent' })
    const bad = await app.inject({ method: 'POST', url: '/messages', headers: auth(), payload: { channel: 'carrier-pigeon' } })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().error).toBe('validation_error')
  })

  it('POST /messages/batch counts accepted + rejected and stops on insufficient balance', async () => {
    vi.mocked(send.sendMessage)
      .mockResolvedValueOnce({ id: 'a', status: 'sent', error: null } as any)
      .mockResolvedValueOnce({ id: 'b', status: 'failed', error: 'bounced' } as any)
      .mockRejectedValueOnce(Object.assign(new (send.SendError as any)(402, 'insufficient_balance', 'broke')))
    const res = await app.inject({ method: 'POST', url: '/messages/batch', headers: auth(), payload: {
      channel: 'email', subject: 'S', template: 'welcome', recipients: [{ to: 'a@b.com' }, { to: 'c@d.com' }, { to: 'e@f.com' }, { to: 'g@h.com' }],
    } })
    expect(res.statusCode).toBe(200)
    const b = res.json()
    expect(b.accepted).toBe(1)
    expect(b.rejected).toContainEqual({ to: 'c@d.com', reason: 'bounced' })
    // the 402 breaks the loop → 4th recipient never attempted (3 calls)
    expect(vi.mocked(send.sendMessage)).toHaveBeenCalledTimes(3)
  })

  it('POST /media hosts a URL and debits media, 422 without url/data', async () => {
    const res = await app.inject({ method: 'POST', url: '/media', headers: auth(), payload: { url: 'https://x/a.png' } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ url: 'https://cdn/x.jpg' })
    const bad = await app.inject({ method: 'POST', url: '/media', headers: auth(), payload: {} })
    expect(bad.statusCode).toBe(422)
    expect(bad.json().error).toBe('invalid_request')
  })

  it('GET /templates (v1) and POST /templates', async () => {
    expect((await app.inject({ url: '/templates', headers: auth() })).json().items).toEqual([{ id: 't', slug: 's' }])
    const post = await app.inject({ method: 'POST', url: '/templates', headers: auth(), payload: { slug: 'welcome', channel: 'email', name: 'X', body: 'body text' } })
    expect(post.statusCode).toBe(200)
  })

  it('GET /v2/templates filters platform rows for a governed non-admin API caller', async () => {
    const res = await app.inject({ url: '/v2/templates', headers: api() })
    expect(res.statusCode).toBe(200)
    expect(res.json().settings).toMatchObject({ editing_enabled: true })
  })

  it('GET /v2/settings returns platform defaults for non-governed, PUT needs admin', async () => {
    expect((await app.inject({ url: '/v2/settings', headers: auth() })).statusCode).toBe(200)
    const forbidden = await app.inject({ method: 'PUT', url: '/v2/settings', headers: auth(), payload: { editing_enabled: false } })
    expect(forbidden.statusCode).toBe(403)
    const ok = await app.inject({ method: 'PUT', url: '/v2/settings', headers: auth({ internal: true }), payload: { editing_enabled: false } })
    expect(ok.statusCode).toBe(200)
    expect(gov.putSettings).toHaveBeenCalled()
  })

  it('review queue + decision are admin-only', async () => {
    expect((await app.inject({ url: '/v2/templates/review', headers: auth() })).statusCode).toBe(403)
    const q = await app.inject({ url: '/v2/templates/review', headers: auth({ internal: true }) })
    expect(q.json().items).toEqual([{ id: 'q1' }])
    const dec = await app.inject({ method: 'POST', url: '/v2/templates/tpl1/review', headers: auth({ internal: true }), payload: { decision: 'approved' } })
    expect(dec.json()).toEqual({ ok: true })
    vi.mocked(gov.reviewDecision).mockResolvedValueOnce(false)
    const none = await app.inject({ method: 'POST', url: '/v2/templates/tpl1/review', headers: auth({ internal: true }), payload: { decision: 'rejected' } })
    expect(none.statusCode).toBe(409)
  })

  it('GET /v2/templates/:channel/:slug returns 404 when missing, else the api shape', async () => {
    vi.mocked(tplv2.findBySlugWithDefaults).mockResolvedValueOnce(null as any)
    expect((await app.inject({ url: '/v2/templates/email/missing', headers: auth() })).statusCode).toBe(404)
    vi.mocked(tplv2.findBySlugWithDefaults).mockResolvedValueOnce({ family: { tenant_id: 't1', slug: 's' }, template: { id: 't1', channel: 'email' } } as any)
    const ok = await app.inject({ url: '/v2/templates/email/s', headers: auth() })
    expect(ok.json()).toMatchObject({ api: true })
  })

  it('POST /v2/templates/preview samples missing vars, 404 without a version', async () => {
    vi.mocked(tplv2.findBySlugWithDefaults).mockResolvedValueOnce({ template: { channel: 'email' }, version: { subject: 'Hi {{customer_name}}', body: 'Order {{order_number}}', preheader: null, layout: 'none' } } as any)
    const res = await app.inject({ method: 'POST', url: '/v2/templates/preview', headers: auth(), payload: { channel: 'email', slug: 's' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().subject).toBe('Hi Priya Sharma')
    expect(res.json().missing).toContain('order_number')
    vi.mocked(tplv2.findBySlugWithDefaults).mockResolvedValueOnce({ template: { channel: 'email' }, version: null } as any)
    expect((await app.inject({ method: 'POST', url: '/v2/templates/preview', headers: auth(), payload: { channel: 'email', slug: 's' } })).statusCode).toBe(404)
  })

  it('POST /v2/templates/validate flags missing vars and multi-segment SMS', async () => {
    const long = 'x'.repeat(200)
    const res = await app.inject({ method: 'POST', url: '/v2/templates/validate', headers: auth(), payload: { channel: 'sms', body: long + ' {{code}}' } })
    const b = res.json()
    expect(b.ok).toBe(false)
    expect(b.missing).toContain('code')
    expect(b.warnings[0]).toMatch(/segments/)
  })

  it('short-links: create returns a code+url; /s/:code redirects or 404s (public)', async () => {
    const mk = await app.inject({ method: 'POST', url: '/short-links', headers: auth(), payload: { destination_url: 'https://dest/page' } })
    const { code } = mk.json()
    expect(mk.json().url).toBe(`https://img.test/${code}`)
    const hit = await app.inject({ url: `/s/${code}` }) // no auth
    expect(hit.statusCode).toBe(302)
    expect(hit.headers.location).toBe('https://dest/page')
    expect((await app.inject({ url: '/s/nope' })).statusCode).toBe(404)
  })

  it('wa submit + sync routes delegate to wa-approval', async () => {
    const sub = await app.inject({ method: 'POST', url: '/wa/submit-approval', headers: auth(), payload: { templateId: 'tpl1' } })
    expect(sub.json()).toMatchObject({ status: 'pending' })
    expect(wa.submit).toHaveBeenCalled()
    const sync = await app.inject({ method: 'POST', url: '/wa/sync-approval', headers: auth(), payload: {} })
    expect(sync.json()).toEqual({ checked: 1, changed: 0 })
  })

  it('system-templates/install is internal-only and reports created/skipped', async () => {
    expect((await app.inject({ method: 'POST', url: '/system-templates/install', headers: auth() })).statusCode).toBe(403)
    vi.mocked(tplv2.findBySlug).mockResolvedValue(null as any)
    const res = await app.inject({ method: 'POST', url: '/system-templates/install', headers: auth({ internal: true }) })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ skipped: 0 })
    expect(res.json().created).toBeGreaterThan(0)
  })

  it('GET /messages/:id 404s when absent; GET /messages lists', async () => {
    expect((await app.inject({ url: '/messages/x', headers: auth() })).statusCode).toBe(404)
    const list = await app.inject({ url: '/messages', headers: auth() })
    expect(list.statusCode).toBe(200)
    expect(list.json()).toHaveProperty('items')
  })

  it('bulk: POST creates a 202 job, GET lists/reads', async () => {
    const create = await app.inject({ method: 'POST', url: '/messages/bulk', headers: auth(), payload: {
      channel: 'email', template: 'welcome', subject: 'S', recipients: [{ to: 'a@b.com' }],
    } })
    expect(create.statusCode).toBe(202)
    expect(create.json()).toMatchObject({ id: 'job1' })
    expect((await app.inject({ url: '/messages/bulk/job1', headers: auth() })).statusCode).toBe(200)
  })

  it('bulk: items, cancel and retry', async () => {
    expect((await app.inject({ url: '/messages/bulk/job1/items', headers: auth() })).statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: '/messages/bulk/job1/cancel', headers: auth() })).statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: '/messages/bulk/job1/retry', headers: auth() })).statusCode).toBe(200)
  })

  it('bulk: POST 404s when the template does not resolve', async () => {
    vi.mocked(send.resolveTemplate).mockResolvedValueOnce(null as any)
    const res = await app.inject({ method: 'POST', url: '/messages/bulk', headers: auth(), payload: {
      channel: 'email', template: 'nope', subject: 'S', recipients: [{ to: 'a@b.com' }],
    } })
    expect(res.statusCode).toBe(404)
  })

  it('POST /media hosts base64 data too', async () => {
    const res = await app.inject({ method: 'POST', url: '/media', headers: auth(), payload: { data: Buffer.from('x').toString('base64'), content_type: 'image/png' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().url).toBe('https://cdn/y.jpg')
  })

  it('every non-webhook route needs a service token', async () => {
    expect((await app.inject({ url: '/messages' })).statusCode).toBe(401)
    expect((await app.inject({ url: '/v2/templates' })).statusCode).toBe(401)
  })

  it('v2 template CRUD: create, update, publish, delete, versions', async () => {
    const create = await app.inject({ method: 'POST', url: '/v2/templates', headers: auth({ internal: true }), payload: { slug: 'welcome', channel: 'email', name: 'W', body: 'hi' } })
    expect(create.statusCode).toBe(200)
    expect(tplv2.upsertTemplate).toHaveBeenCalled()

    vi.mocked(tplv2.findById).mockResolvedValue({ family: { slug: 'welcome', name: 'W' }, template: { id: 't1', channel: 'email' }, variant: { id: 'v1' }, version: { body: 'old', subject: 'S', blocks: null, blocks_format: null, layout: 'store' } } as any)
    const upd = await app.inject({ method: 'PUT', url: '/v2/templates/t1', headers: auth({ internal: true }), payload: { name: 'New name' } })
    expect(upd.statusCode).toBe(200)

    const pub = await app.inject({ method: 'POST', url: '/v2/templates/t1/publish', headers: auth({ internal: true }), payload: { versionId: 'ver1' } })
    expect(pub.json()).toEqual({ ok: true })

    vi.mocked(tplv2.findBySlug).mockResolvedValue({ template: { id: 't1' } } as any)
    const del = await app.inject({ method: 'DELETE', url: '/v2/templates/email/welcome', headers: auth({ internal: true }) })
    expect(del.json()).toEqual({ ok: true })

    const ver = await app.inject({ url: '/v2/templates/t1/versions', headers: auth({ internal: true }) })
    expect(ver.json()).toEqual({ items: [] })
  })

  it('v2 update 404s when the template is not found; delete 404s for a non-owned slug', async () => {
    vi.mocked(tplv2.findById).mockResolvedValue(null as any)
    expect((await app.inject({ method: 'PUT', url: '/v2/templates/missing', headers: auth({ internal: true }), payload: { name: 'x' } })).statusCode).toBe(404)
    vi.mocked(tplv2.findBySlug).mockResolvedValue(null as any)
    expect((await app.inject({ method: 'DELETE', url: '/v2/templates/email/nope', headers: auth({ internal: true }) })).statusCode).toBe(404)
  })

  it('v1 DELETE /templates/:channel/:slug 404s when nothing archived', async () => {
    vi.mocked(tplv1.archiveTemplate).mockResolvedValueOnce(0)
    const res = await app.inject({ method: 'DELETE', url: '/templates/email/welcome', headers: auth() })
    expect(res.statusCode).toBe(404)
  })

  it('Twilio status webhook: no id/status → 400; forged signature → 403', async () => {
    const bad = await app.inject({ method: 'POST', url: '/webhooks/twilio/status', payload: 'x=1', headers: { 'content-type': 'application/x-www-form-urlencoded' } })
    expect(bad.statusCode).toBe(400)
    const forged = await app.inject({ method: 'POST', url: '/webhooks/twilio/status?m=m1', payload: 'MessageStatus=delivered', headers: { 'content-type': 'application/x-www-form-urlencoded' } })
    expect(forged.statusCode).toBe(403)
  })
})
