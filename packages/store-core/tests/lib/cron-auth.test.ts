import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { verifyCronRequest } from '@/lib/shared/cron-auth'

function reqWith(authorization: string | null) {
  return {
    headers: {
      get: (name: string) => (name.toLowerCase() === 'authorization' ? authorization : null),
    },
  }
}

describe('verifyCronRequest', () => {
  const saved = process.env.CRON_SECRET

  beforeEach(() => {
    process.env.CRON_SECRET = 'test-cron-secret'
  })

  afterEach(() => {
    if (saved === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = saved
  })

  it('accepts a matching bearer token', () => {
    expect(verifyCronRequest(reqWith('Bearer test-cron-secret'))).toBe(true)
  })

  it('rejects a wrong secret', () => {
    expect(verifyCronRequest(reqWith('Bearer wrong-secret'))).toBe(false)
  })

  it('rejects a token of a different length', () => {
    expect(verifyCronRequest(reqWith('Bearer test-cron-secret-longer'))).toBe(false)
    expect(verifyCronRequest(reqWith('Bearer short'))).toBe(false)
  })

  it('rejects a missing authorization header', () => {
    expect(verifyCronRequest(reqWith(null))).toBe(false)
  })

  it('rejects the bare secret without the Bearer prefix', () => {
    expect(verifyCronRequest(reqWith('test-cron-secret'))).toBe(false)
  })

  it('rejects any request when CRON_SECRET is not configured', () => {
    delete process.env.CRON_SECRET
    expect(verifyCronRequest(reqWith('Bearer test-cron-secret'))).toBe(false)
    expect(verifyCronRequest(reqWith('Bearer '))).toBe(false)
  })
})
