import crypto from 'crypto'
import { platformOAuthBaseUrl } from '@/lib/catalog/brand'
import type { Network } from './providers/types'

// Sign-in for the networks beyond Meta: one platform callback for all of them (the network rides
// in the signed state). The PKCE verifier is derived from the state's nonce with a server secret,
// so it is never stored or sent to the browser.

export const SOCIAL_CALLBACK_PATH = '/api/admin/social/network/callback'

export function socialRedirectUri(): string {
  return `${platformOAuthBaseUrl()}${SOCIAL_CALLBACK_PATH}`
}

export function pkceVerifier(nonce: string): string {
  const k = process.env.CRON_SECRET
  if (!k) throw new Error('CRON_SECRET not set')
  return crypto.createHmac('sha256', k).update(`social-pkce:${nonce}`).digest('base64url')
}

export function pkceChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url')
}

export const NETWORK_LABEL: Record<Network, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  gbp: 'Google Business Profile',
  youtube: 'YouTube',
  pinterest: 'Pinterest',
  linkedin: 'LinkedIn',
  x: 'X',
}
