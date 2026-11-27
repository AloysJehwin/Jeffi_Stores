import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ query: vi.fn(), transition: vi.fn(), startDraft: vi.fn(), mergeBrief: vi.fn(), send: vi.fn(), getShowcaseById: vi.fn() }))
vi.mock('@controller/lib/outreach/db', () => ({ outreachPool: () => ({ query: h.query }) }))
vi.mock('@controller/lib/outreach/session', () => ({ knownBrief: vi.fn(), readVoiceSettings: vi.fn() }))
vi.mock('@controller/lib/outreach/whatsapp', () => ({ sendOutreachTemplate: h.send, windowOpen: vi.fn() }))
vi.mock('@controller/lib/outreach/build', () => ({ OutreachBuildError: class extends Error {}, startDraft: h.startDraft, mergeBrief: h.mergeBrief, requestChange: vi.fn(), publish: vi.fn() }))
vi.mock('@controller/lib/outreach/state', async orig => ({ ...(await orig<typeof import('@controller/lib/outreach/state')>()), transition: h.transition }))
vi.mock('@/lib/showcase/store', () => ({ getShowcaseById: h.getShowcaseById }))

import { addDetails, getSiteStatus, startPreview } from '@controller/lib/outreach/agent/tools/showcase'
import { HARD_LIMITS } from '@controller/lib/outreach/agent/limits'
import { LINES } from '@controller/lib/outreach/prompt'

const NOW = new Date('2026-11-27T06:00:00Z')
let status = 'interested'
const ctx = (o: Record<string, unknown> = {}, contact: Record<string, unknown> = {}) =>
  ({
    channel: 'whatsapp', actor: 'outreach:agent',
    contact: { id: 'k1', business_name: 'Ravi Stores', status, consent_whatsapp_at: '2026-11-26T05:00:00Z', showcase_site_id: null, extra: {}, ...contact },
    call: null, run: { id: 'r1' }, language: 'en', now: NOW, limits: HARD_LIMITS, scriptVersion: 'x', ...o,
  }) as any

beforeEach(() => {
  vi.clearAllMocks()
  status = 'interested'
  h.query.mockImplementation(async (sql: string) => (sql.startsWith('SELECT status') ? { rows: [{ status }] } : { rows: [], rowCount: 1 }))
  h.transition.mockImplementation(async (_c: unknown, to: string) => {
    status = to
    return {}
  })
  h.getShowcaseById.mockResolvedValue(null)
})

describe('startPreview off a call', () => {
  it('sends the preview link, moves to preview_sent and returns data (the line becomes the note in invokeTool)', async () => {
    h.startDraft.mockResolvedValue({ siteId: 's1', previewUrl: 'https://site-x/preview?t=abc' })
    h.send.mockResolvedValue({ ok: true, mode: 'captured', messageId: 'm1', providerMessageId: null })
    const r = await startPreview.run(ctx(), { business_name: 'Ravi Stores' })
    expect(h.send).toHaveBeenCalledWith('k1', { template: 'preview_ready', url: 'https://site-x/preview?t=abc', actor: 'outreach:agent', callId: null })
    expect(r).toMatchObject({ ok: true, say: LINES.en.previewSent, data: { sent: true, kind: 'preview', mode: 'captured' } })
    expect(JSON.stringify(r.data)).not.toContain('t=abc')
    expect(h.transition.mock.calls.map(c => c[1])).toEqual(['preview_sent'])
  })

  it('needs consent, and reports a failed send honestly', async () => {
    expect(await startPreview.run(ctx({}, { consent_whatsapp_at: null }), { business_name: 'R' })).toMatchObject({ ok: false, error: 'no_whatsapp_consent' })
    expect(h.startDraft).not.toHaveBeenCalled()
    h.startDraft.mockResolvedValue({ siteId: 's1', previewUrl: 'u' })
    h.send.mockResolvedValue({ ok: false, reason: 'window_closed' })
    expect(await startPreview.run(ctx(), { business_name: 'Ravi' })).toMatchObject({ ok: false, error: 'window_closed' })
    expect(h.transition).not.toHaveBeenCalled()
  })
})

describe('addDetails data', () => {
  it('gives the LLM what is still missing off voice, nothing extra on voice', async () => {
    h.mergeBrief.mockResolvedValue({ building: false, missing: ['hours', 'address'] })
    expect((await addDetails.run(ctx(), { hours: '9-9' })).data).toEqual({ building: false, missing: ['hours', 'address'] })
    expect((await addDetails.run(ctx({ channel: 'voice' }), { hours: '9-9' })).data).toBeUndefined()
  })
})

describe('getSiteStatus', () => {
  it('reports build state, missing details and what is available', async () => {
    h.getShowcaseById.mockResolvedValue({ status: 'draft' })
    const extra = { build: { state: 'done', builds: 1, builtAt: '2026-11-27T05:00:00Z' }, brief: { whatTheyDo: 'sarees', audience: 'women' } }
    const r = await getSiteStatus.run(ctx({}, { showcase_site_id: 's1', status: 'preview_sent', extra }), {})
    expect(r.data).toMatchObject({
      started: true, siteStatus: 'draft', published: false, claimed: false, previewAvailable: true,
      build: { state: 'done', builds: 1, designed: true },
    })
    expect((r.data!.missing as string[]).includes('whatTheyDo')).toBe(false)
    expect(r.data!.missing).toEqual(expect.arrayContaining(['highlights', 'hours']))
  })

  it('a contact without a site', async () => {
    const r = await getSiteStatus.run(ctx(), {})
    expect(r.data).toMatchObject({ started: false, siteStatus: null, previewAvailable: false, build: { state: 'idle', designed: false } })
  })
})
