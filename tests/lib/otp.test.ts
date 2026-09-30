import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/redis', () => ({
  default: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    incr: vi.fn(),
    ttl: vi.fn(),
    expire: vi.fn(),
  },
}))

import {
  generateOTP,
  storeOTP,
  verifyOTP,
  isOTPVerified,
  deleteOTP,
  checkSendOtpRateLimit,
  recordSendOtp,
  resetSendOtpCounter,
} from '@/lib/otp'
import redis from '@/lib/redis'

const mockRedis = vi.mocked(redis)

describe('generateOTP', () => {
  it('returns a 6-digit numeric string', () => {
    const otp = generateOTP()
    expect(otp).toMatch(/^\d{6}$/)
  })

  it('generates different values on successive calls (statistical)', () => {
    const values = new Set(Array.from({ length: 20 }, () => generateOTP()))
    expect(values.size).toBeGreaterThan(1)
  })
})

describe('storeOTP', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sets otp key and attempts key in redis', async () => {
    mockRedis.set = vi.fn().mockResolvedValue('OK')
    await storeOTP('User@Example.COM', '123456')
    expect(mockRedis.set).toHaveBeenCalledWith('otp:user@example.com', '123456', 'EX', 600)
    expect(mockRedis.set).toHaveBeenCalledWith('otp:attempts:user@example.com', '0', 'EX', 600)
  })

  it('normalises email to lowercase', async () => {
    mockRedis.set = vi.fn().mockResolvedValue('OK')
    await storeOTP('TEST@DOMAIN.COM', '999999')
    expect(mockRedis.set).toHaveBeenCalledWith('otp:test@domain.com', '999999', 'EX', 600)
  })
})

describe('verifyOTP', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns invalid when no OTP stored', async () => {
    mockRedis.get = vi.fn().mockResolvedValue(null)
    const result = await verifyOTP('a@b.com', '123456')
    expect(result.valid).toBe(false)
    expect(result.message).toContain('No OTP')
  })

  it('returns invalid and increments attempts on wrong OTP', async () => {
    mockRedis.get = vi
      .fn()
      .mockResolvedValueOnce('654321') // storedOtp
      .mockResolvedValueOnce('0') // attempts
    mockRedis.del = vi.fn().mockResolvedValue(1)
    mockRedis.incr = vi.fn().mockResolvedValue(1)
    const result = await verifyOTP('a@b.com', '000000')
    expect(result.valid).toBe(false)
    expect(result.message).toContain('Invalid OTP')
    expect(mockRedis.incr).toHaveBeenCalledWith('otp:attempts:a@b.com')
  })

  it('returns invalid and clears keys when attempts >= MAX', async () => {
    mockRedis.get = vi
      .fn()
      .mockResolvedValueOnce('654321') // storedOtp
      .mockResolvedValueOnce('5') // attempts = 5 >= MAX_ATTEMPTS
    mockRedis.del = vi.fn().mockResolvedValue(1)
    const result = await verifyOTP('a@b.com', '000000')
    expect(result.valid).toBe(false)
    expect(result.message).toContain('Too many failed attempts')
    expect(mockRedis.del).toHaveBeenCalledWith('otp:a@b.com')
  })

  it('returns valid on correct OTP and stores verified flag', async () => {
    mockRedis.get = vi
      .fn()
      .mockResolvedValueOnce('123456') // storedOtp
      .mockResolvedValueOnce('0') // attempts
    mockRedis.ttl = vi.fn().mockResolvedValue(300)
    mockRedis.set = vi.fn().mockResolvedValue('OK')
    const result = await verifyOTP('a@b.com', '123456')
    expect(result.valid).toBe(true)
    expect(result.message).toContain('verified')
    expect(mockRedis.set).toHaveBeenCalledWith('otp:verified:a@b.com', 'true', 'EX', 300)
  })

  it('uses fallback TTL of 300 when ttl returns <= 0', async () => {
    mockRedis.get = vi.fn().mockResolvedValueOnce('111111').mockResolvedValueOnce('0')
    mockRedis.ttl = vi.fn().mockResolvedValue(-1)
    mockRedis.set = vi.fn().mockResolvedValue('OK')
    await verifyOTP('b@c.com', '111111')
    expect(mockRedis.set).toHaveBeenCalledWith('otp:verified:b@c.com', 'true', 'EX', 300)
  })
})

describe('isOTPVerified', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns true when redis key is "true"', async () => {
    mockRedis.get = vi.fn().mockResolvedValue('true')
    expect(await isOTPVerified('a@b.com')).toBe(true)
  })

  it('returns false when redis key is null', async () => {
    mockRedis.get = vi.fn().mockResolvedValue(null)
    expect(await isOTPVerified('a@b.com')).toBe(false)
  })

  it('returns false for any other value', async () => {
    mockRedis.get = vi.fn().mockResolvedValue('false')
    expect(await isOTPVerified('a@b.com')).toBe(false)
  })
})

describe('deleteOTP', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deletes all three OTP keys', async () => {
    mockRedis.del = vi.fn().mockResolvedValue(1)
    await deleteOTP('user@test.com')
    expect(mockRedis.del).toHaveBeenCalledWith('otp:user@test.com')
    expect(mockRedis.del).toHaveBeenCalledWith('otp:attempts:user@test.com')
    expect(mockRedis.del).toHaveBeenCalledWith('otp:verified:user@test.com')
  })
})

describe('checkSendOtpRateLimit', () => {
  beforeEach(() => vi.clearAllMocks())

  it('allows first send (no previous send)', async () => {
    mockRedis.get = vi
      .fn()
      .mockResolvedValueOnce(null) // lastSend
      .mockResolvedValueOnce(null) // sendCount
    const result = await checkSendOtpRateLimit('a@b.com')
    expect(result.allowed).toBe(true)
    expect(result.retryAfter).toBe(0)
  })

  it('blocks when within cooldown window', async () => {
    const now = Math.floor(Date.now() / 1000)
    mockRedis.get = vi
      .fn()
      .mockResolvedValueOnce(String(now - 10)) // sent 10s ago
      .mockResolvedValueOnce('1') // sendCount = 1
    const result = await checkSendOtpRateLimit('a@b.com')
    expect(result.allowed).toBe(false)
    expect(result.retryAfter).toBeGreaterThan(0)
  })
})

describe('recordSendOtp', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sets lastSend and increments sendCount', async () => {
    mockRedis.set = vi.fn().mockResolvedValue('OK')
    mockRedis.incr = vi.fn().mockResolvedValue(1)
    mockRedis.get = vi.fn().mockResolvedValue('1')
    await recordSendOtp('user@test.com')
    expect(mockRedis.set).toHaveBeenCalledWith('otp:lastSend:user@test.com', expect.any(String), 'EX', 3600)
    expect(mockRedis.incr).toHaveBeenCalledWith('otp:sendCount:user@test.com')
  })
})

describe('resetSendOtpCounter', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deletes lastSend and sendCount keys', async () => {
    mockRedis.del = vi.fn().mockResolvedValue(1)
    await resetSendOtpCounter('user@test.com')
    expect(mockRedis.del).toHaveBeenCalledWith('otp:lastSend:user@test.com')
    expect(mockRedis.del).toHaveBeenCalledWith('otp:sendCount:user@test.com')
  })
})
