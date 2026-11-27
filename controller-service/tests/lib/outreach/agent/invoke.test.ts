import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'

const h = vi.hoisted(() => ({ query: vi.fn(), run: vi.fn(), isSuppressed: vi.fn() }))
vi.mock('@controller/lib/outreach/db', () => ({ outreachPool: () => ({ query: h.query }) }))
vi.mock('@controller/lib/outreach/suppress', () => ({ isSuppressed: h.isSuppressed }))
vi.mock('@controller/lib/outreach/build', () => ({
  OutreachBuildError: class OutreachBuildError extends Error {
    constructor(readonly code: string, message: string) {
      super(message)
    }
  },
}))
vi.mock('@controller/lib/outreach/agent/catalog', () => {
  const mk = (name: string, o: Record<string, unknown> = {}) => ({
    name, description: name, channels: ['voice', 'whatsapp', 'follow_up'], effect: 'write', args: z.object({ n: z.number().optional() }), inputSchema: {}, run: h.run, ...o,
  })
  const tools: Record<string, unknown> = {
    doIt: mk('doIt'),
    sendIt: mk('sendIt', { effect: 'send' }),
    peek: mk('peek', { effect: 'read' }),
    voiceOnly: mk('voiceOnly', { channels: ['voice'] }),
    optOut: mk('optOut', { mandatory: true }),
    needs: mk('needs', { args: z.object({ text: z.string().min(1) }) }),
  }
  return { getTool: (n: string) => tools[n] ?? null, MANDATORY_TOOLS: ['optOut', 'handOff'] }
})

import { invokeTool } from '@controller/lib/outreach/agent/invoke'
import { OutreachBuildError } from '@controller/lib/outreach/build'
import { HARD_LIMITS } from '@controller/lib/outreach/agent/limits'
import { LINES } from '@controller/lib/outreach/prompt'

const NOW = new Date('2026-11-27T06:00:00Z')
const base = (o: Record<string, unknown> = {}) =>
  ({
    channel: 'voice',
    actor: 'voice',
    contact: { id: 'k1', phone: '+919876543210', status: 'interested', opted_out_at: null },
    call: { id: 'c1' },
    run: { id: 'r1' },
    language: 'en',
    now: NOW,
    limits: HARD_LIMITS,
    scriptVersion: 'v1',
    name: 'doIt',
    args: {},
    allowed: ['doIt', 'sendIt', 'peek', 'voiceOnly', 'needs'],
    ...o,
  }) as any
const events = () => h.query.mock.calls.filter(c => String(c[0]).startsWith('INSERT INTO outreach_events')).map(c => ({ kind: c[1][2], callId: c[1][1], actor: c[1][4], data: JSON.parse(c[1][3]) }))

beforeEach(() => {
  vi.clearAllMocks()
  h.query.mockResolvedValue({ rows: [], rowCount: 1 })
  h.isSuppressed.mockResolvedValue(false)
  h.run.mockResolvedValue({ ok: true })
})

describe('invokeTool access', () => {
  it('404s an unknown tool', async () => {
    expect(await invokeTool(base({ name: 'nope' }))).toMatchObject({ status: 404, ok: false })
    expect(h.run).not.toHaveBeenCalled()
  })

  it('403s a tool the skill does not allow, but always lets a mandatory tool run', async () => {
    expect(await invokeTool(base({ allowed: [] }))).toEqual({ status: 403, ok: false, error: 'not_allowed' })
    expect(h.run).not.toHaveBeenCalled()
    expect((await invokeTool(base({ name: 'optOut', allowed: [] }))).status).toBe(200)
    expect(h.run).toHaveBeenCalledTimes(1)
  })

  it('403s a tool that cannot run on this channel, even when the skill lists it', async () => {
    expect((await invokeTool(base({ name: 'voiceOnly', channel: 'whatsapp' }))).status).toBe(403)
    expect((await invokeTool(base({ name: 'voiceOnly' }))).status).toBe(200)
  })

  it('400s bad args with "path: message" and audits without the args', async () => {
    const r = await invokeTool(base({ name: 'needs', args: { text: '' } }))
    expect(r.status).toBe(400)
    expect(r.error).toMatch(/^text: /)
    expect(events()[0].data).toMatchObject({ tool: 'needs', ok: false, channel: 'voice', runId: 'r1' })
    expect(events()[0].data.args).toBeUndefined()
    expect(h.run).not.toHaveBeenCalled()
  })

  it('treats missing args as {}', async () => {
    expect((await invokeTool(base({ args: undefined }))).status).toBe(200)
    expect(h.run.mock.calls[0][1]).toEqual({})
  })
})

describe('contact gate', () => {
  it('refuses a side effect for an opted-out or suppressed contact with the code (voice also ends the call)', async () => {
    const out = await invokeTool(base({ name: 'sendIt', contact: { id: 'k1', phone: 'p', status: 'opted_out', opted_out_at: 'x' } }))
    expect(out).toMatchObject({ status: 200, ok: false, error: 'opted_out', say: LINES.en.optedOut, end: true })
    h.isSuppressed.mockResolvedValueOnce(true)
    expect(await invokeTool(base({ name: 'sendIt', channel: 'whatsapp' }))).toEqual({ status: 200, ok: false, error: 'suppressed' })
    expect(h.run).not.toHaveBeenCalled()
  })

  it('reads and optOut pass the gate', async () => {
    const stopped = { id: 'k1', phone: 'p', status: 'opted_out', opted_out_at: 'x' }
    expect((await invokeTool(base({ name: 'peek', contact: stopped }))).ok).toBe(true)
    expect((await invokeTool(base({ name: 'optOut', contact: stopped }))).ok).toBe(true)
  })
})

describe('results', () => {
  it('voice keeps say, end, redialLanguage and data; detail never leaves', async () => {
    h.run.mockResolvedValue({ ok: true, say: 'Bye', end: true, redialLanguage: 'ta', data: { x: 1 }, detail: { secret: 1 } })
    const r = await invokeTool(base())
    expect(r).toEqual({ status: 200, ok: true, say: 'Bye', end: true, redialLanguage: 'ta', data: { x: 1 } })
  })

  it('off voice a say becomes data.note and end / redialLanguage are dropped', async () => {
    h.run.mockResolvedValue({ ok: false, say: 'Need consent first', end: true, redialLanguage: 'ta', data: { x: 1 }, error: 'no_consent' })
    for (const channel of ['whatsapp', 'follow_up']) {
      expect(await invokeTool(base({ channel }))).toEqual({ status: 200, ok: false, error: 'no_consent', data: { x: 1, note: 'Need consent first' } })
    }
  })

  it('a thrown handler is ok:false with the soft line on voice only, and the detail is audited', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    h.run.mockRejectedValue(new Error('boom'))
    expect(await invokeTool(base())).toEqual({ status: 200, ok: false, say: LINES.en.failedSoft, error: 'failed' })
    expect(await invokeTool(base({ channel: 'whatsapp' }))).toEqual({ status: 200, ok: false, error: 'failed' })
    expect(events().at(-1)!.data.detail).toEqual({ error: 'boom' })
  })

  it('a build refusal is said as today: English as is, other languages from LINES, opted out ends', async () => {
    h.run.mockRejectedValueOnce(new OutreachBuildError('details', 'I need the name.'))
    expect(await invokeTool(base())).toMatchObject({ ok: false, say: 'I need the name.', error: 'details' })
    h.run.mockRejectedValueOnce(new OutreachBuildError('building', 'Still designing.'))
    expect(await invokeTool(base({ language: 'ta' }))).toMatchObject({ say: LINES.ta.buildBusy })
    h.run.mockRejectedValueOnce(new OutreachBuildError('opted_out', 'No.'))
    expect(await invokeTool(base({ language: 'hi' }))).toMatchObject({ say: LINES.hi.optedOut, end: true })
    h.run.mockRejectedValueOnce(new OutreachBuildError('details', 'Before it goes live...'))
    expect(await invokeTool(base({ name: 'sendIt', channel: 'whatsapp' }))).toEqual({ status: 200, ok: false, error: 'details', data: { note: 'Before it goes live...' } })
  })
})

describe('audit', () => {
  it('records a tool_call event with channel, run, args and outcome', async () => {
    h.run.mockResolvedValue({ ok: true, say: 'Done', data: { private: 'x' }, detail: { siteId: 's1' } })
    await invokeTool(base({ name: 'sendIt', args: { n: 2 }, channel: 'whatsapp', actor: 'outreach:agent', call: null }))
    expect(events()).toEqual([
      {
        kind: 'tool_call',
        callId: null,
        actor: 'outreach:agent',
        data: { tool: 'sendIt', channel: 'whatsapp', runId: 'r1', args: { n: 2 }, ok: true, say: 'Done', detail: { siteId: 's1' } },
      },
    ])
  })

  it('a failing audit write never fails the call', async () => {
    h.query.mockRejectedValue(new Error('db down'))
    expect((await invokeTool(base())).ok).toBe(true)
  })
})
