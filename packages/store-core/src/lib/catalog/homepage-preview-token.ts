import { SignJWT, jwtVerify } from 'jose'
import type { HomepageAudience } from '@/lib/catalog/homepage-sections'

// The admin preview opens the storefront (another app, another host) with `?preview=<token>`: a
// short-lived HS256 token over the shared JWT_SECRET naming the draft, since the admin's session
// cookie never reaches the store's host. Only a settings:write admin can mint one.

const TYPE = 'homepage_preview'
const TTL = '4h'

export interface HomepagePreviewClaims {
  draftId: string
  audience: HomepageAudience
}

const secret = () => new TextEncoder().encode(process.env.JWT_SECRET || '')

export async function signHomepagePreviewToken(claims: HomepagePreviewClaims): Promise<string> {
  return new SignJWT({ type: TYPE, draftId: claims.draftId, audience: claims.audience })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(TTL)
    .sign(secret())
}

export async function verifyHomepagePreviewToken(token: string | null | undefined): Promise<HomepagePreviewClaims | null> {
  if (!token || !process.env.JWT_SECRET) return null
  try {
    const { payload } = await jwtVerify(token, secret())
    if (payload.type !== TYPE || typeof payload.draftId !== 'string') return null
    return { draftId: payload.draftId, audience: payload.audience === 'business' ? 'business' : 'store' }
  } catch {
    return null
  }
}
