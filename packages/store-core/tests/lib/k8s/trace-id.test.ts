import { describe, it, expect, vi, beforeEach } from 'vitest'

let active: { spanContext: () => { traceId: string } } | undefined
vi.mock('@opentelemetry/api', () => ({ trace: { getActiveSpan: () => active } }))

import { currentTraceId, installTraceLogPrefix } from '@/lib/shared/otel'

const span = (traceId: string) => ({ spanContext: () => ({ traceId }) })

beforeEach(() => {
  active = undefined
})

describe('trace id', () => {
  it('returns the active trace id, null outside a request or for the invalid id', () => {
    expect(currentTraceId()).toBeNull()
    active = span('4bf92f3577b34da6a3ce929d0e0e4736')
    expect(currentTraceId()).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
    active = span('0'.repeat(32))
    expect(currentTraceId()).toBeNull()
  })

  it('prefixes log lines inside a request only', () => {
    const lines: unknown[][] = []
    const fake = {
      log: (...a: unknown[]) => lines.push(a),
      info: () => {},
      warn: () => {},
      error: (...a: unknown[]) => lines.push(a),
    }
    installTraceLogPrefix(fake)
    fake.log('boot')
    active = span('abc123abc123abc123abc123abc12345')
    fake.error('upload failed', 42)
    expect(lines).toEqual([['boot'], ['[trace=abc123abc123abc123abc123abc12345]', 'upload failed', 42]])
  })
})
