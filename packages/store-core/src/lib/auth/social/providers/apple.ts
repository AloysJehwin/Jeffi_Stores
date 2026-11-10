import { SignJWT, createRemoteJWKSet, importPKCS8, jwtVerify } from 'jose'
import { FORM_HEADERS, SocialProviderError, fetchJson, formBody, type SocialProviderModule } from './shared'
import type { SocialCredentials } from '../types'

const ISSUER = 'https://appleid.apple.com'
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/auth/keys`))

/** Apple's client_secret: a short-lived ES256 JWT signed with the store's .p8 key. */
export async function appleClientSecret(creds: SocialCredentials): Promise<string> {
  const key = await importPKCS8(creds.privateKey || '', 'ES256')
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: creds.keyId })
    .setIssuer(creds.teamId || '')
    .setSubject(creds.clientId)
    .setAudience(ISSUER)
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(key)
}

export const apple: SocialProviderModule = {
  formPost: true,
  authorizeUrl({ creds, redirectUri, state, nonce }) {
    const qs = new URLSearchParams({
      client_id: creds.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      response_mode: 'form_post',
      scope: 'name email',
      state,
      nonce,
    })
    return `${ISSUER}/auth/authorize?${qs}`
  },
  async exchange({ creds, redirectUri, code, nonce, userField }) {
    const token = await fetchJson(`${ISSUER}/auth/token`, {
      method: 'POST',
      headers: FORM_HEADERS,
      body: formBody({
        client_id: creds.clientId,
        client_secret: await appleClientSecret(creds),
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    })
    if (!token.id_token) throw new SocialProviderError('no id token')
    const { payload } = await jwtVerify(token.id_token, JWKS, { issuer: ISSUER, audience: creds.clientId }).catch(() => {
      throw new SocialProviderError('invalid id token')
    })
    if (!payload.sub || payload.nonce !== nonce) throw new SocialProviderError('invalid id token')
    let firstName = ''
    let lastName = ''
    try {
      const u = userField ? JSON.parse(userField) : null
      firstName = String(u?.name?.firstName || '').slice(0, 100)
      lastName = String(u?.name?.lastName || '').slice(0, 100)
    } catch {}
    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : null
    return {
      subject: payload.sub,
      email,
      emailVerified: !!email && (payload.email_verified === true || payload.email_verified === 'true'),
      firstName,
      lastName,
      picture: null,
    }
  },
}
