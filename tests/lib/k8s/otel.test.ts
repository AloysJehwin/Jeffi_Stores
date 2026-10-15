import { describe, it, expect, vi, afterEach } from 'vitest'

const registerOTel = vi.fn()
vi.mock('@vercel/otel', () => ({ registerOTel: (...a: unknown[]) => registerOTel(...a) }))
vi.mock('@/lib/shared/redis', () => ({ default: { set: vi.fn().mockResolvedValue('OK') } }))

import { otelEnabled, otelOptions } from '@/lib/shared/otel'
import { register } from '@/instrumentation'

afterEach(() => {
  registerOTel.mockClear()
  for (const k of ['NEXT_RUNTIME', 'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT', 'IN_PROCESS_CRON']) delete process.env[k]
})

describe('otel', () => {
  it('is off unless an OTLP endpoint is configured', () => {
    expect(otelEnabled({})).toBe(false)
    expect(otelEnabled({ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://c:8080/v1/traces' })).toBe(true)
    expect(otelEnabled({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://c:8080', OTEL_SDK_DISABLED: 'true' })).toBe(false)
  })

  it('tags spans with the host, never a client-assertable tenant header', () => {
    const o = otelOptions({ OTEL_SERVICE_NAME: 'svc', NEXT_PUBLIC_GIT_SHA: 'abc' })
    expect(o.serviceName).toBe('svc')
    expect(o.attributes['vcs.revision']).toBe('abc')
    expect(o.attributesFromHeaders).toEqual({ 'http.host': 'host' })
  })

  it('registers from instrumentation only when enabled, independent of the cron gate', async () => {
    process.env.NEXT_RUNTIME = 'nodejs'
    process.env.IN_PROCESS_CRON = 'false'
    await register()
    expect(registerOTel).not.toHaveBeenCalled()
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = 'http://coroot:8080/v1/traces'
    await register()
    expect(registerOTel).toHaveBeenCalledWith(expect.objectContaining({ serviceName: 'jeffi-storefront' }))
  })
})
