import { FORM_HEADERS, SocialProviderError, fetchJson, formBody, type SocialProviderModule } from './shared'
import { splitName } from '../types'

const API_HEADERS = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'jeffi-stores-sign-in',
})

export const github: SocialProviderModule = {
  authorizeUrl({ creds, redirectUri, state, codeChallenge }) {
    const qs = new URLSearchParams({
      client_id: creds.clientId,
      redirect_uri: redirectUri,
      scope: 'read:user user:email',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    })
    return `https://github.com/login/oauth/authorize?${qs}`
  },
  async exchange({ creds, redirectUri, code, codeVerifier }) {
    const token = await fetchJson('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: FORM_HEADERS,
      body: formBody({
        client_id: creds.clientId,
        client_secret: creds.clientSecret || '',
        code,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
      }),
    })
    if (!token.access_token) throw new SocialProviderError('no access token')
    const user = await fetchJson('https://api.github.com/user', { headers: API_HEADERS(token.access_token) })
    if (!user.id) throw new SocialProviderError('no subject')
    // Only the primary, verified address; a profile's public email is not proof of ownership.
    let email: string | null = null
    try {
      const res = await fetch('https://api.github.com/user/emails', {
        headers: API_HEADERS(token.access_token),
        signal: AbortSignal.timeout(10_000),
        cache: 'no-store',
      })
      const emails = res.ok ? await res.json() : []
      const primary = Array.isArray(emails) ? emails.find((e: any) => e?.primary && e?.verified) : null
      if (primary?.email) email = String(primary.email).toLowerCase()
    } catch {}
    const name = splitName(user.name || user.login)
    return {
      subject: String(user.id),
      email,
      emailVerified: !!email,
      firstName: name.firstName,
      lastName: name.lastName,
      picture: user.avatar_url || null,
    }
  },
}
