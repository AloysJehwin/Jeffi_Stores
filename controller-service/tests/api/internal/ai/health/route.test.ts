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

const mockFetch = vi.fn()
global.fetch = mockFetch
let gatewayChat: () => any
let readyz: () => any
let providers: () => any

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
  vi.stubEnv('OLLAMA_BASE_URL', 'http://ollama.test:11434')
  vi.stubEnv('NODE_ENV', 'production')
  vi.spyOn(console, 'error').mockImplementation(() => {})
  gatewayChat = () => res(200, { content: 'OK', fallbackUsed: false })
  readyz = () => res(200, { ok: true })
  providers = () => res(200, { text: [{ name: 'anthropic', configured: true }, { name: 'razer', configured: false }] })
  mockFetch.mockReset()
  mockFetch.mockImplementation(async (url: string) => {
    const u = String(url)
    if (u.includes('ollama.test')) throw new Error(`direct Ollama call: ${u}`)
    if (u.endsWith('/v1/chat')) return gatewayChat()
    if (u.endsWith('/readyz')) return readyz()
    if (u.endsWith('/v1/providers')) return providers()
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

  it('checks only the gateway: a tiny uncached chat, /readyz and /v1/providers', async () => {
    const r = await GET(req())
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ ok: true, incident: 'healthy', ready: { ok: true }, providers: { ok: true, text: ['anthropic'] } })
    const chat = mockFetch.mock.calls.find(([u]) => String(u).endsWith('/v1/chat'))!
    expect(JSON.parse(chat[1].body)).toMatchObject({ noCache: true, cacheNamespace: 'ai-health', maxTokens: 5 })
    expect(mockFetch.mock.calls.every(([u]) => !String(u).includes('ollama.test'))).toBe(true)
    expect(sendPlatformAlert).not.toHaveBeenCalled()
  })

  it('alerts once per incident, then once on recovery', async () => {
    gatewayChat = () => res(500, { error: 'all text providers failed' })
    readyz = () => res(503, { ok: false, reason: 'no healthy Ollama' })

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
    expect(sendPlatformAlert).toHaveBeenCalledTimes(1)

    gatewayChat = () => res(200, { content: 'OK' })
    readyz = () => res(200, { ok: true })
    expect((await (await GET(req())).json()).incident).toBe('recovered')
    expect(sendPlatformAlert).toHaveBeenCalledTimes(2)
    expect(vi.mocked(sendPlatformAlert).mock.calls[1][0]).toContain('recovered')
    expect(store.has(INCIDENT_KEY)).toBe(false)
  })

  it('treats a not-ready gateway or no configured text provider as an incident', async () => {
    readyz = () => res(503, { ok: false, reason: 'redis queue unreachable' })
    const notReady = await (await GET(req())).json()
    expect(notReady.reasons).toEqual(['gateway /readyz HTTP 503: redis queue unreachable'])
    store.clear()

    readyz = () => res(200, { ok: true })
    providers = () => res(200, { text: [{ name: 'anthropic', configured: false }] })
    const none = await (await GET(req())).json()
    expect(none.reasons).toEqual(['gateway /v1/providers: no text provider is configured'])
  })

  it('ignores a gateway that predates /readyz', async () => {
    readyz = () => res(404, {})
    const r = await GET(req())
    expect(r.status).toBe(200)
    expect((await r.json()).ready).toEqual({ ok: null })
  })

  it('never sends mail outside production', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    gatewayChat = () => { throw new TypeError('fetch failed') }
    expect((await (await GET(req())).json()).incident).toBe('opened')
    expect(sendPlatformAlert).not.toHaveBeenCalled()
  })
})
