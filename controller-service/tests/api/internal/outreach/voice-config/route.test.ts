import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { signServiceToken } from '@jeffi/service-auth'

const getVoiceConfigView = vi.hoisted(() => vi.fn())
vi.mock('@/lib/providers/voice-config', () => ({ getVoiceConfigView }))

import { GET } from '@controller/app/api/(internal)/internal/outreach/voice-config/route'

const url = 'http://localhost/api/internal/outreach/voice-config'
const req = (auth?: string) => new NextRequest(url, { headers: auth ? { authorization: auth } : {} })
const token = (service: string) => signServiceToken({ service, tenantId: '00000000-0000-0000-0000-000000000000' })

const config = {
  provider: 'exotel',
  exotel: { accountSid: 'jeffi1', subdomain: 'api.in.exotel.com', callerId: '+911401234567', appId: '1' },
  twilioTest: { from: '' },
  testNumbers: [],
  sarvam: { sttModel: 'saaras:v3', ttsModel: 'bulbul:v3', voices: { en: 'ishita' } },
  speech: { sttProvider: 'sarvam', ttsProvider: 'sarvam' },
  azureSpeech: { region: 'centralindia', voices: {} },
  llmModel: 'claude-haiku-5-5',
  anthropicIdentity: null,
  parts: { exotel: false, twilio: false, calling: false, sarvam: false, azure: false, speech: false, claude: false },
  ready: false,
}

describe('GET /api/internal/outreach/voice-config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getVoiceConfigView.mockResolvedValue(config)
  })

  it('is 401 without a valid voice service token', async () => {
    expect((await GET(req())).status).toBe(401)
    expect((await GET(req('Bearer garbage'))).status).toBe(401)
    expect((await GET(req(`Bearer ${token('messaging')}`))).status).toBe(401)
    const forged = token('voice').replace(/\.[^.]+$/, '.AAAA')
    expect((await GET(req(`Bearer ${forged}`))).status).toBe(401)
    expect(getVoiceConfigView).not.toHaveBeenCalled()
  })

  it('returns the non-secret voice config to voice-service, never cached', async () => {
    const r = await GET(req(`Bearer ${token('voice')}`))
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toBe('no-store')
    const j = await r.json()
    expect(j).toEqual(config)
    expect(JSON.stringify(j)).not.toMatch(/apiKey|apiToken|authToken|accountSid":"AC/)
  })

  it('is 503 when the config cannot be read', async () => {
    getVoiceConfigView.mockRejectedValue(new Error('control plane down'))
    const r = await GET(req(`Bearer ${token('voice')}`))
    expect(r.status).toBe(503)
    expect(await r.text()).not.toContain('control plane down')
  })
})
