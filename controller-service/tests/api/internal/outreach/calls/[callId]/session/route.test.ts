import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { signServiceToken } from '@jeffi/service-auth'

const buildSession = vi.hoisted(() => vi.fn())
vi.mock('@controller/lib/outreach/agent/runtime', () => ({ buildVoiceSession: buildSession }))

import { GET } from '@controller/app/api/(internal)/internal/outreach/calls/[callId]/session/route'

const CALL = '11111111-1111-4111-8111-111111111111'
const token = (service: string, callId?: string) =>
  `Bearer ${signServiceToken({ service, tenantId: '00000000-0000-0000-0000-000000000000', ...(callId ? { callId } : {}) } as any)}`
const get = (auth?: string, id = CALL) =>
  GET(new NextRequest(`http://localhost/api/internal/outreach/calls/${id}/session`, { headers: auth ? { authorization: auth } : {} }), {
    params: Promise.resolve({ callId: id }),
  })

beforeEach(() => {
  vi.clearAllMocks()
  buildSession.mockResolvedValue({ language: 'en', persona: { name: 'Priya', voiceId: 'ishita' }, systemPrompt: 'p', greeting: 'g', tools: [], maxDurationS: 720, silenceS: 14, skillRef: 'showcase-offer/2026-11-24.1' })
})

describe('GET /api/internal/outreach/calls/[callId]/session', () => {
  it('401s without a voice token, or with one bound to another call', async () => {
    expect((await get()).status).toBe(401)
    expect((await get(token('messaging'))).status).toBe(401)
    expect((await get(token('voice', '22222222-2222-4222-8222-222222222222'))).status).toBe(401)
    expect(buildSession).not.toHaveBeenCalled()
  })

  it('returns the session, never cached', async () => {
    const r = await get(token('voice', CALL))
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toBe('no-store')
    const body = await r.json()
    expect(body.persona).toEqual({ name: 'Priya', voiceId: 'ishita' })
    expect(body.skillRef).toBe('showcase-offer/2026-11-24.1')
    expect(buildSession).toHaveBeenCalledWith(CALL)
  })

  it('400 for a bad id, 404 for an unknown call, 500 on failure', async () => {
    expect((await get(token('voice'), 'nope')).status).toBe(400)
    buildSession.mockResolvedValueOnce(null)
    expect((await get(token('voice'))).status).toBe(404)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    buildSession.mockRejectedValueOnce(new Error('db down'))
    const r = await get(token('voice'))
    expect(r.status).toBe(500)
    expect(await r.text()).not.toContain('db down')
  })
})
