import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import {
  zUuid,
  zEmail,
  zIndianPin,
  zPositiveInt,
  zNonEmpty,
  zCurrency,
  zPhone,
  parseBody,
} from '@/lib/validate'

// ---------------------------------------------------------------------------
// zUuid
// ---------------------------------------------------------------------------
describe('zUuid', () => {
  it('accepts a valid UUID v4', () => {
    expect(zUuid.safeParse('550e8400-e29b-41d4-a716-446655440000').success).toBe(true)
  })

  it('rejects a non-UUID string', () => {
    expect(zUuid.safeParse('not-a-uuid').success).toBe(false)
    expect(zUuid.safeParse('12345').success).toBe(false)
    expect(zUuid.safeParse('').success).toBe(false)
  })

  it('rejects a null / undefined', () => {
    expect(zUuid.safeParse(null).success).toBe(false)
    expect(zUuid.safeParse(undefined).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// zEmail
// ---------------------------------------------------------------------------
describe('zEmail', () => {
  it('accepts a valid email', () => {
    const result = zEmail.safeParse('User@Example.COM')
    expect(result.success).toBe(true)
  })

  it('transforms email to lowercase', () => {
    const result = zEmail.safeParse('User@EXAMPLE.com')
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toBe('user@example.com')
  })

  it('rejects an email without @', () => {
    expect(zEmail.safeParse('notanemail').success).toBe(false)
  })

  it('rejects empty string', () => {
    expect(zEmail.safeParse('').success).toBe(false)
  })

  it('rejects null', () => {
    expect(zEmail.safeParse(null).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// zIndianPin
// ---------------------------------------------------------------------------
describe('zIndianPin', () => {
  it('accepts a valid 6-digit pin code', () => {
    expect(zIndianPin.safeParse('560001').success).toBe(true)
    expect(zIndianPin.safeParse('110001').success).toBe(true)
  })

  it('rejects pin with fewer than 6 digits', () => {
    expect(zIndianPin.safeParse('56000').success).toBe(false)
  })

  it('rejects pin with more than 6 digits', () => {
    expect(zIndianPin.safeParse('5600011').success).toBe(false)
  })

  it('rejects non-numeric characters', () => {
    expect(zIndianPin.safeParse('56000A').success).toBe(false)
    expect(zIndianPin.safeParse('ABC123').success).toBe(false)
  })

  it('rejects empty string', () => {
    expect(zIndianPin.safeParse('').success).toBe(false)
  })

  it('rejects null', () => {
    expect(zIndianPin.safeParse(null).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// zPositiveInt
// ---------------------------------------------------------------------------
describe('zPositiveInt', () => {
  it('accepts 1 (boundary)', () => {
    expect(zPositiveInt.safeParse(1).success).toBe(true)
  })

  it('accepts large integers', () => {
    expect(zPositiveInt.safeParse(1000000).success).toBe(true)
  })

  it('rejects 0', () => {
    expect(zPositiveInt.safeParse(0).success).toBe(false)
  })

  it('rejects negative integers', () => {
    expect(zPositiveInt.safeParse(-1).success).toBe(false)
  })

  it('rejects floats', () => {
    expect(zPositiveInt.safeParse(1.5).success).toBe(false)
  })

  it('rejects string numbers', () => {
    expect(zPositiveInt.safeParse('5').success).toBe(false)
  })

  it('rejects null', () => {
    expect(zPositiveInt.safeParse(null).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// zNonEmpty
// ---------------------------------------------------------------------------
describe('zNonEmpty', () => {
  it('accepts a plain string', () => {
    expect(zNonEmpty.safeParse('hello').success).toBe(true)
  })

  it('rejects empty string', () => {
    expect(zNonEmpty.safeParse('').success).toBe(false)
  })

  it('rejects whitespace-only strings (trim + min check)', () => {
    expect(zNonEmpty.safeParse('   ').success).toBe(false)
    expect(zNonEmpty.safeParse('\t').success).toBe(false)
  })

  it('trims whitespace before validation', () => {
    const result = zNonEmpty.safeParse('  hello  ')
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toBe('hello')
  })

  it('rejects null', () => {
    expect(zNonEmpty.safeParse(null).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// zCurrency
// ---------------------------------------------------------------------------
describe('zCurrency', () => {
  it('accepts 0 (boundary)', () => {
    expect(zCurrency.safeParse(0).success).toBe(true)
  })

  it('accepts positive number', () => {
    expect(zCurrency.safeParse(999.99).success).toBe(true)
  })

  it('coerces a string number', () => {
    const result = zCurrency.safeParse('123.45')
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toBe(123.45)
  })

  it('rejects negative values', () => {
    expect(zCurrency.safeParse(-1).success).toBe(false)
  })

  it('rejects non-numeric strings', () => {
    expect(zCurrency.safeParse('abc').success).toBe(false)
  })

  it('coerces null to 0 (z.coerce.number behaviour) — accepted at min(0)', () => {
    // z.coerce.number() converts null → 0, which satisfies min(0)
    const result = zCurrency.safeParse(null)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// zPhone
// ---------------------------------------------------------------------------
describe('zPhone', () => {
  it('accepts valid Indian mobile starting with 9', () => {
    expect(zPhone.safeParse('9876543210').success).toBe(true)
  })

  it('accepts numbers starting with 6, 7, 8', () => {
    expect(zPhone.safeParse('6789012345').success).toBe(true)
    expect(zPhone.safeParse('7890123456').success).toBe(true)
    expect(zPhone.safeParse('8901234567').success).toBe(true)
  })

  it('rejects numbers starting with 5 or below', () => {
    expect(zPhone.safeParse('5876543210').success).toBe(false)
    expect(zPhone.safeParse('1234567890').success).toBe(false)
    expect(zPhone.safeParse('0123456789').success).toBe(false)
  })

  it('rejects numbers with fewer than 10 digits', () => {
    expect(zPhone.safeParse('987654321').success).toBe(false)
  })

  it('rejects numbers with more than 10 digits', () => {
    expect(zPhone.safeParse('98765432101').success).toBe(false)
  })

  it('rejects non-numeric characters', () => {
    expect(zPhone.safeParse('98765432AB').success).toBe(false)
    expect(zPhone.safeParse('+919876543210').success).toBe(false)
  })

  it('rejects empty string', () => {
    expect(zPhone.safeParse('').success).toBe(false)
  })

  it('rejects null', () => {
    expect(zPhone.safeParse(null).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// parseBody
// ---------------------------------------------------------------------------
describe('parseBody', () => {
  const schema = z.object({
    name: z.string().min(1),
    age: z.number().int().min(0),
  })

  it('returns ok:true with parsed data on valid input', () => {
    const result = parseBody(schema, { name: 'Alice', age: 30 })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.name).toBe('Alice')
      expect(result.data.age).toBe(30)
    }
  })

  it('returns ok:false with a NextResponse on invalid input', () => {
    const result = parseBody(schema, { name: '', age: -1 })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response).toBeDefined()
      expect(result.response.status).toBe(400)
    }
  })

  it('returns ok:false when required field is missing', () => {
    const result = parseBody(schema, { name: 'Alice' })
    expect(result.ok).toBe(false)
  })

  it('includes field errors in the response body', async () => {
    const result = parseBody(schema, { name: '', age: -5 })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const body = await result.response.json()
      expect(body.error).toBe('Validation failed')
      // field-level errors should be present
      expect(body.fields).toBeDefined()
    }
  })

  it('handles null input', () => {
    const result = parseBody(schema, null)
    expect(result.ok).toBe(false)
  })

  it('handles completely wrong type', () => {
    const result = parseBody(schema, 'a string')
    expect(result.ok).toBe(false)
  })

  it('handles empty object', () => {
    const result = parseBody(schema, {})
    expect(result.ok).toBe(false)
  })

  it('does not throw when context is provided', () => {
    expect(() =>
      parseBody(schema, { bad: true }, 'test-context')
    ).not.toThrow()
  })

  it('works with a simple string schema', () => {
    const strSchema = z.string().min(3)
    expect(parseBody(strSchema, 'hello').ok).toBe(true)
    expect(parseBody(strSchema, 'hi').ok).toBe(false)
  })
})
