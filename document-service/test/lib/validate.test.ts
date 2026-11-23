import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import {
  zUuid,
  zNonEmpty,
  zCurrency,
  zPositiveInt,
  parseBody,
  zEmail,
  zPhone,
  zIndianPin,
} from '../../src/lib/validate.js'

describe('zod primitives', () => {
  it('zUuid accepts a uuid and rejects junk', () => {
    expect(zUuid.safeParse('550e8400-e29b-41d4-a716-446655440000').success).toBe(true)
    expect(zUuid.safeParse('nope').success).toBe(false)
  })
  it('zNonEmpty trims and requires content', () => {
    expect(zNonEmpty.parse('  hi  ')).toBe('hi')
    expect(zNonEmpty.safeParse('   ').success).toBe(false)
  })
  it('zCurrency coerces and rejects negatives', () => {
    expect(zCurrency.parse('12.5')).toBe(12.5)
    expect(zCurrency.safeParse(-1).success).toBe(false)
  })
  it('zPositiveInt requires an int >= 1', () => {
    expect(zPositiveInt.parse(3)).toBe(3)
    expect(zPositiveInt.safeParse(0).success).toBe(false)
    expect(zPositiveInt.safeParse(1.5).success).toBe(false)
  })
  it('zEmail lowercases', () => {
    expect(zEmail.parse('Foo@Bar.COM')).toBe('foo@bar.com')
    expect(zEmail.safeParse('bad').success).toBe(false)
  })
  it('zPhone matches 10-digit Indian mobiles', () => {
    expect(zPhone.safeParse('9876543210').success).toBe(true)
    expect(zPhone.safeParse('1234567890').success).toBe(false)
  })
  it('zIndianPin matches 6 digits', () => {
    expect(zIndianPin.safeParse('600001').success).toBe(true)
    expect(zIndianPin.safeParse('6000').success).toBe(false)
  })
})

describe('parseBody', () => {
  const schema = z.object({ name: zNonEmpty, age: zPositiveInt })

  it('returns ok with parsed data on success', () => {
    const r = parseBody(schema, { name: 'A', age: 2 })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toEqual({ name: 'A', age: 2 })
  })

  it('returns a 400 response with field errors on failure', async () => {
    const r = parseBody(schema, { name: '', age: 0 })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.response.status).toBe(400)
      const body = await r.response.json()
      expect(body.error).toBe('Validation failed')
      expect(body.fields.name).toBeTruthy()
      expect(body.fields.age).toBeTruthy()
    }
  })

  it('omits fields when the error has no path', async () => {
    // a top-level type error carries an empty path → no fields object
    const r = parseBody(z.string(), 123)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      const body = await r.response.json()
      expect(body.error).toBe('Validation failed')
      expect(body.fields).toBeUndefined()
    }
  })
})
