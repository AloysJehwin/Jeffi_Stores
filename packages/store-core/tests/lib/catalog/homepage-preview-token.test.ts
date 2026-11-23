import { describe, it, expect, afterEach } from 'vitest'
import { SignJWT } from 'jose'
import { signHomepagePreviewToken, verifyHomepagePreviewToken } from '@/lib/catalog/homepage-preview-token'

const SECRET = () => new TextEncoder().encode(process.env.JWT_SECRET || '')

describe('homepage preview token', () => {
  afterEach(() => {
    process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-bytes!!'
  })

  it('round-trips a homepage draft token (default kind)', async () => {
    const token = await signHomepagePreviewToken({ draftId: 'd1', audience: 'store' })
    const claims = await verifyHomepagePreviewToken(token)
    expect(claims).toEqual({ draftId: 'd1', audience: 'store', kind: 'homepage' })
  })

  it('preserves the business audience and the site kind', async () => {
    const token = await signHomepagePreviewToken({ draftId: 'd2', audience: 'business', kind: 'site' })
    expect(await verifyHomepagePreviewToken(token)).toEqual({ draftId: 'd2', audience: 'business', kind: 'site' })
  })

  it('normalises an unknown audience to store and unknown kind to homepage', async () => {
    // Mint a raw token with odd values; verify coerces them.
    const token = await new SignJWT({ type: 'homepage_preview', draftId: 'd3', audience: 'weird', kind: 'weird' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('4h')
      .sign(SECRET())
    expect(await verifyHomepagePreviewToken(token)).toEqual({ draftId: 'd3', audience: 'store', kind: 'homepage' })
  })

  it('returns null for a missing/empty token', async () => {
    expect(await verifyHomepagePreviewToken(null)).toBeNull()
    expect(await verifyHomepagePreviewToken(undefined)).toBeNull()
    expect(await verifyHomepagePreviewToken('')).toBeNull()
  })

  it('returns null when JWT_SECRET is unset', async () => {
    const token = await signHomepagePreviewToken({ draftId: 'd1', audience: 'store' })
    delete process.env.JWT_SECRET
    expect(await verifyHomepagePreviewToken(token)).toBeNull()
  })

  it('returns null for a garbage token', async () => {
    expect(await verifyHomepagePreviewToken('not.a.jwt')).toBeNull()
  })

  it('rejects a token of the wrong type', async () => {
    const token = await new SignJWT({ type: 'other', draftId: 'd1', audience: 'store' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('4h')
      .sign(SECRET())
    expect(await verifyHomepagePreviewToken(token)).toBeNull()
  })

  it('rejects a token with a non-string draftId', async () => {
    const token = await new SignJWT({ type: 'homepage_preview', draftId: 123, audience: 'store' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('4h')
      .sign(SECRET())
    expect(await verifyHomepagePreviewToken(token)).toBeNull()
  })

  it('rejects a token signed with a different secret', async () => {
    const token = await new SignJWT({ type: 'homepage_preview', draftId: 'd1', audience: 'store' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('4h')
      .sign(new TextEncoder().encode('a-totally-different-secret-value!!'))
    expect(await verifyHomepagePreviewToken(token)).toBeNull()
  })
})
