import { describe, it, expect } from 'vitest'
import { stateFromPincode } from '@/lib/india-pincode-state'

/**
 * Razorpay rejects an unrecognised state name. The old code took it positionally from the
 * free-text business address and produced 'IN', which failed the linked-account create and
 * with it the stakeholder and settlement bank.
 */
describe('stateFromPincode', () => {
  it('resolves the pincode from the failing onboarding', () => {
    expect(stateFromPincode('560048')).toBe('Karnataka')
  })

  it('resolves common circles', () => {
    expect(stateFromPincode('110001')).toBe('Delhi')
    expect(stateFromPincode('400001')).toBe('Maharashtra')
    expect(stateFromPincode('600001')).toBe('Tamil Nadu')
    expect(stateFromPincode('700001')).toBe('West Bengal')
    expect(stateFromPincode('492001')).toBe('Chhattisgarh')  // the platform's own origin
  })

  it('prefers a three-digit match over its two-digit circle', () => {
    expect(stateFromPincode('403001')).toBe('Goa')          // inside Maharashtra's 40x
    expect(stateFromPincode('605001')).toBe('Puducherry')   // inside Tamil Nadu's 60x
    expect(stateFromPincode('248001')).toBe('Uttarakhand')  // inside Uttar Pradesh's 24x
    expect(stateFromPincode('201001')).toBe('Uttar Pradesh')
  })

  it('returns null for circles that span more than one state', () => {
    // Better an actionable error than a guess Razorpay may reject or silently mis-file.
    expect(stateFromPincode('520001')).toBeNull()  // Andhra / Telangana
    expect(stateFromPincode('800001')).toBeNull()  // Bihar / Jharkhand
    expect(stateFromPincode('790001')).toBeNull()  // north-eastern circle
  })

  it('returns null for anything that is not a 6-digit pincode', () => {
    expect(stateFromPincode('')).toBeNull()
    expect(stateFromPincode('5600')).toBeNull()
    expect(stateFromPincode('fgugcijhvb')).toBeNull()
    expect(stateFromPincode(null)).toBeNull()
    expect(stateFromPincode(undefined)).toBeNull()
  })
})
