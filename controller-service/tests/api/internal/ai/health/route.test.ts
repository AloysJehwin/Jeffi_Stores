import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const store = new Map<string, string>()
vi.mock('@/lib/shared/redis', () => ({
  getRedisClient: () => ({
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string) => { store.set(k, v); return 'OK' },
    del: async (k: string) => (store.delete(k) ? 1 : 0),
  }),
}))
vi.mock('@controller/lib/provisioning/alerts', () => ({ sendPlatformAlert: vi.fn(async () => {}) }))

import { GET } from '@controller/app/api/(internal)/internal/ai/health/route'
import { INCIDENT_KEY } from '@controller/lib/shared/ai-health'
import { sendPlatformAlert } from '@controller/lib/provisioning/alerts'

const OLLAMA = 'http://ollama.test:11434'
const mockFetch = vi.fn()
global.fetch = mockFetch
let gatewayChat: () => any
let ollamaUp = true

const res = (status: number, body: unknown) => ({
  ok: status < 400,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
})

function req(auth = 'Bearer test-cron-secret') {
  return new NextRequest('http://localhost/api/internal/ai/health', { headers: auth ? { authorization: auth } : {} })
}

beforeEach(() => {
  store.clear()
  vi.mocked(sendPlatformAlert).mockClear()
  vi.stubEnv('CRON_SECRET', 'test-cron-secret')
  vi.stubEnv('OLLAMA_BASE_URL', OLLAMA)
  vi.stubEnv('NODE_ENV', 'production')
  vi.spyOn(console, 'error').mockImplementation(() => {})
  gatewayChat = () => res(200, { content: 'OK', fallbackUsed: false })
  ollamaUp = true
  mockFetch.mockReset()
  mockFetch.mockImplementation(async (url: string) => {
    const u = String(url)
    if (u.startsWith(OLLAMA)) {
      if (!ollamaUp) throw new TypeError('fetch failed')
      return res(200, { models: [] })
    }
    if (u.endsWith('/v1/chat')) return gatewayChat()
    if (u.endsWith('/readyz')) return res(503, { ok: false, reason: 'no healthy Ollama' })
    throw new Error(`unexpected ${u}`)
  })
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('GET /api/internal/ai/health', () => {
  it('rejects without the cron secret', async () => {
    expect((await GET(req(''))).status).toBe(401)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('runs a tiny uncached gateway chat and stays quiet when healthy', async () => {
    const r = await GET(req())
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ ok: true, incident: 'healthy' })
    const chat = mockFetch.mock.calls.find(([u]) => String(u).endsWith('/v1/chat'))!
    expect(JSON.parse(chat[1].body)).toMatchObject({ noCache: true, cacheNamespace: 'ai-health', maxTokens: 5 })
    expect(sendPlatformAlert).not.toHaveBeenCalled()
  })

  it('alerts once per incident, then once on recovery', async () => {
    gatewayChat = () => res(500, { error: 'Ollama is not reachable' })

    const first = await GET(req())
    expect(first.status).toBe(503)
    const body = await first.json()
    expect(body.incident).toBe('opened')
    expect(body.reasons[0]).toContain('gateway chat HTTP 500')
    expect(body.reasons[0]).toContain('no healthy Ollama')
    expect(sendPlatformAlert).toHaveBeenCalledTimes(1)
    expect(vi.mocked(sendPlatformAlert).mock.calls[0][0]).toContain('DOWN')
    expect(store.has(INCIDENT_KEY)).toBe(true)

    expect((await (await GET(req())).json()).incident).toBe('ongoing')
    expect((await (await GET(req())).json()).incident).toBe('ongoing')
    expect(sendPlatformAlert).toHaveBeenCalledTimes(1)

    gatewayChat = () => res(200, { content: 'OK' })
    expect((await (await GET(req())).json()).incident).toBe('recovered')
    expect(sendPlatformAlert).toHaveBeenCalledTimes(2)
    expect(vi.mocked(sendPlatformAlert).mock.calls[1][0]).toContain('recovered')
    expect(store.has(INCIDENT_KEY)).toBe(false)

    expect((await (await GET(req())).json()).incident).toBe('healthy')
    expect(sendPlatformAlert).toHaveBeenCalledTimes(2)
  })

  it('treats an unreachable direct Ollama as an incident (fallback broken)', async () => {
    ollamaUp = false
    const r = await GET(req())
    expect(r.status).toBe(503)
    expect((await r.json()).reasons.join()).toContain('direct Ollama')
    expect(sendPlatformAlert).toHaveBeenCalledTimes(1)
  })

  it('never sends mail outside production', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    gatewayChat = () => { throw new TypeError('fetch failed') }
    expect((await (await GET(req())).json()).incident).toBe('opened')
    expect(sendPlatformAlert).not.toHaveBeenCalled()
  })
})
