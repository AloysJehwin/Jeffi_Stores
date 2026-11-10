import { FORM_HEADERS, SocialProviderError, fetchJson, formBody, type SocialProviderModule } from './shared'
import { splitName } from '../types'

// The store's own Google client, authorization-code flow with PKCE.
export const google: SocialProviderModule = {
  authorizeUrl({ creds, redirectUri, state, codeChallenge, nonce }) {
    const qs = new URLSearchParams({
      client_id: creds.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    })
    return `https://accounts.google.com/o/oauth2/v2/auth?${qs}`
  },
  async exchange({ creds, redirectUri, code, codeVerifier }) {
    const token = await fetchJson('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: FORM_HEADERS,
      body: formBody({
        client_id: creds.clientId,
        client_secret: creds.clientSecret || '',
        code,
        code_verifier: codeVerifier,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    })
    if (!token.access_token) throw new SocialProviderError('no access token')
    const u = await fetchJson('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token.access_token}` },
    })
    if (!u.sub) throw new SocialProviderError('no subject')
    const fallback = splitName(u.name)
    return {
      subject: String(u.sub),
      email: u.email ? String(u.email).toLowerCase() : null,
      emailVerified: u.email_verified === true || u.email_verified === 'true',
      firstName: u.given_name || fallback.firstName,
      lastName: u.family_name || fallback.lastName,
      picture: u.picture || null,
    }
  },
}
