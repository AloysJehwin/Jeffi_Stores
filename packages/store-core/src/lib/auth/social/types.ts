// Customer sign-in providers. Client-safe: no server imports.

export const SOCIAL_PROVIDERS = ['google', 'facebook', 'apple', 'github'] as const
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number]
export type SocialPortal = 'store' | 'business'

export const SOCIAL_LABEL: Record<SocialProvider, string> = {
  google: 'Google',
  facebook: 'Facebook',
  apple: 'Apple',
  github: 'GitHub',
}

export const isSocialProvider = (v: unknown): v is SocialProvider => SOCIAL_PROVIDERS.includes(v as SocialProvider)

export interface SocialProfile {
  subject: string
  email: string | null
  emailVerified: boolean
  firstName: string
  lastName: string
  picture: string | null
}

/** A store's own app for a provider. Apple: clientId = Services ID, privateKey = the .p8 key. */
export interface SocialCredentials {
  clientId: string
  clientSecret?: string
  teamId?: string
  keyId?: string
  privateKey?: string
}

/** `redirect` = the store's own app (code flow); `google_platform` = the platform Google client (popup). */
export interface SignInMethod {
  id: SocialProvider
  label: string
  flow: 'redirect' | 'google_platform'
}

export const OAUTH_ERRORS: Record<string, string> = {
  cancelled: 'Sign-in was cancelled.',
  not_available: 'That sign-in method is not available on this store.',
  expired: 'The sign-in took too long or was started in another browser. Please try again.',
  provider: 'We could not complete the sign-in with that provider. Please try again.',
  inactive: 'This account is inactive. Please contact support.',
  failed: 'Sign-in failed. Please try again.',
}

export const oauthErrorMessage = (code: string | null | undefined) =>
  code ? (OAUTH_ERRORS[code] ?? OAUTH_ERRORS.failed) : ''

export const splitName = (name: string | null | undefined): { firstName: string; lastName: string } => {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') }
}
