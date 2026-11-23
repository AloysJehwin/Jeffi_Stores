// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { authorized, parseTokens } from '../src/auth'

describe('gateway auth', () => {
  const tokens = parseTokens(' test-fake-new , test-fake-old ,,test-fake-new')

  it('parses a comma-separated rotation list', () => {
    expect(tokens).toEqual(['test-fake-new', 'test-fake-old'])
  })

  it('is open when no token is configured', () => {
    expect(authorized('/v1/chat', undefined, [])).toBe(true)
  })

  it('keeps the probes open', () => {
    expect(authorized('/healthz', undefined, tokens)).toBe(true)
    expect(authorized('/readyz', undefined, tokens)).toBe(true)
  })

  it('needs a configured bearer token on everything else', () => {
    expect(authorized('/v1/chat', 'Bearer test-fake-new', tokens)).toBe(true)
    expect(authorized('/v1/files/abc', 'bearer test-fake-old', tokens)).toBe(true)
    expect(authorized('/v1/chat', undefined, tokens)).toBe(false)
    expect(authorized('/v1/chat', 'Bearer wrong', tokens)).toBe(false)
    expect(authorized('/v1/chat', 'test-fake-new', tokens)).toBe(false)
    expect(authorized('/v1/chat', 'Bearer test-fake-new,test-fake-old', tokens)).toBe(false)
    expect(authorized('/nope', undefined, tokens)).toBe(false)
  })
})
