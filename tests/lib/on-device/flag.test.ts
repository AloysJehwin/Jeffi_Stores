import { describe, it, expect, afterEach } from 'vitest'

import { isOnDeviceSummaryEnabled } from '@/lib/on-device/flag'

const ENV_KEY = 'NEXT_PUBLIC_ENABLE_ONDEVICE_SUMMARY'

describe('isOnDeviceSummaryEnabled', () => {
  const original = process.env[ENV_KEY]

  afterEach(() => {
    if (original === undefined) {
      delete process.env[ENV_KEY]
    } else {
      process.env[ENV_KEY] = original
    }
  })

  it("returns true when the flag is exactly 'true'", () => {
    process.env[ENV_KEY] = 'true'
    expect(isOnDeviceSummaryEnabled()).toBe(true)
  })

  it("returns true when the flag is '1'", () => {
    process.env[ENV_KEY] = '1'
    expect(isOnDeviceSummaryEnabled()).toBe(true)
  })

  it('returns false when the flag is unset (undefined)', () => {
    delete process.env[ENV_KEY]
    expect(isOnDeviceSummaryEnabled()).toBe(false)
  })

  it("returns false when the flag is 'false'", () => {
    process.env[ENV_KEY] = 'false'
    expect(isOnDeviceSummaryEnabled()).toBe(false)
  })

  it("returns false when the flag is '0'", () => {
    process.env[ENV_KEY] = '0'
    expect(isOnDeviceSummaryEnabled()).toBe(false)
  })

  it('returns false for an empty string', () => {
    process.env[ENV_KEY] = ''
    expect(isOnDeviceSummaryEnabled()).toBe(false)
  })

  it("returns false for a truthy-looking but non-matching value ('TRUE')", () => {
    // The check is case-sensitive and exact, so 'TRUE' must NOT enable the flag.
    process.env[ENV_KEY] = 'TRUE'
    expect(isOnDeviceSummaryEnabled()).toBe(false)
  })

  it("returns false for other arbitrary values ('yes')", () => {
    process.env[ENV_KEY] = 'yes'
    expect(isOnDeviceSummaryEnabled()).toBe(false)
  })
})
