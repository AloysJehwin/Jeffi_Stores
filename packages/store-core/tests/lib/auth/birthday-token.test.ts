import { describe, it, expect } from 'vitest'
import {
  generateBirthdayToken,
  verifyBirthdayToken,
  generateReviewToken,
  verifyReviewToken,
} from '@/lib/auth/jwt'

// Real jose signing (tests/lib/jwt.test.ts stubs jose, so a round-trip can't be checked there).
describe('birthday token', () => {
  it('round-trips the user id', async () => {
    const token = await generateBirthdayToken('u1')
    expect(await verifyBirthdayToken(token)).toEqual({ userId: 'u1' })
  })

  it('is not interchangeable with a review token in either direction', async () => {
    const review = await generateReviewToken({ orderId: 'o1', productId: 'p1', userId: 'u1' })
    expect(await verifyBirthdayToken(review)).toBeNull()
    expect(await verifyReviewToken(await generateBirthdayToken('u1'))).toBeNull()
  })

  it('rejects garbage', async () => {
    expect(await verifyBirthdayToken('not-a-token')).toBeNull()
  })
})
