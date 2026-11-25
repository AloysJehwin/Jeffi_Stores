import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { signServiceToken } from '@jeffi/service-auth'

const handleCallEvent = vi.hoisted(() => vi.fn())
vi.mock('@controller/lib/outreach/call-events', () => ({ handleCallEvent }))

import { POST } from '@controller/app/api/(internal)/internal/outreach/calls/[callId]/events/route'

const CALL = '11111111-1111-4111-8111-111111111111'
const token = (service = 'voice') => `Bearer ${signServiceToken({ service, tenantId: '00000000-0000-0000-0000-000000000000', callId: CALL } as any)}`
const post = (body: unknown, auth: string | null = token(), id = CALL) =>
  POST(
    new NextRequest(`http://localhost/api/internal/outreach/calls/${id}/events`, {
      method: 'POST',
      headers: auth ? { authorization: auth } : {},
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ callId: id }) }
  )

beforeEach(() => {
  vi.clearAllMocks()
  handleCallEvent.mockResolvedValue({ status: 200, body: { ok: true } })
})

describe('POST /api/internal/outreach/calls/[callId]/events', () => {
  it('401s without a voice token', async () => {
    expect((await post({ type: 'ringing' }, null)).status).toBe(401)
    expect((await post({ type: 'ringing' }, token('document'))).status).toBe(401)
    expect(handleCallEvent).not.toHaveBeenCalled()
  })

  it('400s a body without a type', async () => {
    expect((await post({ data: {} })).status).toBe(400)
    expect((await post('x')).status).toBe(400)
  })

  it('hands the event to the lib and relays its answer', async () => {
    const body = { type: 'ended', at: '2026-11-25T06:00:00Z', data: { durationS: 40, terminal: true } }
    const r = await post(body)
    expect(r.status).toBe(200)
    expect(handleCallEvent).toHaveBeenCalledWith(CALL, body)
    handleCallEvent.mockResolvedValueOnce({ status: 200, body: { ok: true, duplicate: true } })
    expect(await (await post(body)).json()).toEqual({ ok: true, duplicate: true })
    handleCallEvent.mockResolvedValueOnce({ status: 404, body: { error: 'Unknown call' } })
    expect((await post(body)).status).toBe(404)
  })

  it('500s when recording fails, so voice-service retries', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    handleCallEvent.mockRejectedValueOnce(new Error('db down'))
    expect((await post({ type: 'answered' })).status).toBe(500)
  })
})
