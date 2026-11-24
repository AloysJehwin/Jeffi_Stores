import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { signServiceToken, verifyServiceToken } from '@jeffi/service-auth'
import { placeCall, hangupCall, verifyVoiceRequest, voiceServiceUrl, VoiceServiceError } from '@controller/lib/outreach/voice-client'

const CALL = '11111111-1111-4111-8111-111111111111'
const fetchMock = vi.fn()
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('VOICE_SERVICE_URL', 'http://voice:8080/')
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('placeCall / hangupCall', () => {
  it('posts the call with a verifiable service token', async () => {
    fetchMock.mockResolvedValue(reply(200, { providerCallId: 'p1' }))
    expect(await placeCall({ callId: CALL, to: '+919876543210', from: '+911400000000', language: 'hi' })).toEqual({ providerCallId: 'p1', duplicate: false })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://voice:8080/calls')
    expect(JSON.parse(init.body)).toEqual({ callId: CALL, to: '+919876543210', from: '+911400000000', language: 'hi' })
    const claims = verifyServiceToken(init.headers.authorization.slice(7))
    expect(claims).toMatchObject({ service: 'controller', internal: true })
  })

  it('a refusal carries the status and detail', async () => {
    fetchMock.mockResolvedValue(reply(503, { error: 'voice-service is not configured', missing: ['sarvam.apiKey'] }))
    const e = await placeCall({ callId: CALL, to: '+91', from: '', language: 'en' }).catch(x => x)
    expect(e).toBeInstanceOf(VoiceServiceError)
    expect(e.status).toBe(503)
    expect(e.refused).toBe(true)
    expect(e.detail).toEqual({ missing: ['sarvam.apiKey'] })
  })

  it('no answer is status 0, not a refusal', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))
    const e = await placeCall({ callId: CALL, to: '+91', from: '', language: 'en' }).catch(x => x)
    expect(e.status).toBe(0)
    expect(e.refused).toBe(false)
  })

  it('refuses to run without VOICE_SERVICE_URL', async () => {
    vi.stubEnv('VOICE_SERVICE_URL', '')
    expect(voiceServiceUrl()).toBeNull()
    await expect(placeCall({ callId: CALL, to: '+91', from: '', language: 'en' })).rejects.toMatchObject({ status: 503 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('hangs up', async () => {
    fetchMock.mockResolvedValue(reply(200, { ok: true }))
    expect(await hangupCall(CALL)).toBe(true)
    expect(fetchMock.mock.calls[0][0]).toBe(`http://voice:8080/calls/${CALL}/hangup`)
    fetchMock.mockResolvedValue(reply(404, { ok: false }))
    expect(await hangupCall(CALL)).toBe(false)
  })
})

describe('verifyVoiceRequest', () => {
  const req = (auth?: string) => new NextRequest('http://localhost/x', { headers: auth ? { authorization: auth } : {} })
  const tok = (claims: Record<string, unknown>) => `Bearer ${signServiceToken({ tenantId: '00000000-0000-0000-0000-000000000000', ...claims } as any)}`

  it('accepts voice-service, bound to this call or unbound', () => {
    expect(verifyVoiceRequest(req(tok({ service: 'voice', callId: CALL })), CALL)).toMatchObject({ service: 'voice' })
    expect(verifyVoiceRequest(req(tok({ service: 'voice' })), CALL)).toMatchObject({ service: 'voice' })
  })

  it('refuses other services, other calls, forgeries and garbage', () => {
    expect(verifyVoiceRequest(req(tok({ service: 'messaging' })), CALL)).toBeNull()
    expect(verifyVoiceRequest(req(tok({ service: 'voice', callId: 'other' })), CALL)).toBeNull()
    expect(verifyVoiceRequest(req(tok({ service: 'voice' }).replace(/\.[^.]+$/, '.AAAA')), CALL)).toBeNull()
    expect(verifyVoiceRequest(req('Bearer not.a-token'), CALL)).toBeNull()
    expect(verifyVoiceRequest(req(), CALL)).toBeNull()
  })
})
