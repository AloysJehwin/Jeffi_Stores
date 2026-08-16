// Shared Google token verification — pure (no account table coupling), so both
// the customer login route and the ecom owner route can reuse it. Verifies a
// Google ID token or access token and returns the identity, or null.

export interface GoogleIdentity {
  sub: string
  email: string
  given_name?: string
  family_name?: string
  name?: string
  picture?: string
}

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''

export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity | null> {
  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`)
    if (!res.ok) return null
    const data = await res.json()
    if (!data.sub || !data.email) return null
    if (GOOGLE_CLIENT_ID) {
      const aud = Array.isArray(data.aud) ? data.aud : [data.aud]
      if (!aud.includes(GOOGLE_CLIENT_ID)) return null
    }
    return data as GoogleIdentity
  } catch {
    return null
  }
}

export async function verifyGoogleAccessToken(accessToken: string): Promise<GoogleIdentity | null> {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return null
    const data = await res.json()
    if (!data.sub || !data.email || data.email_verified === false) return null
    return { sub: data.sub, email: data.email, given_name: data.given_name, family_name: data.family_name, name: data.name, picture: data.picture }
  } catch {
    return null
  }
}

/** Accepts either an id_token or access_token; returns the identity or null. */
export async function verifyGoogle(args: { idToken?: string; accessToken?: string }): Promise<GoogleIdentity | null> {
  if (args.idToken) return verifyGoogleIdToken(args.idToken)
  if (args.accessToken) return verifyGoogleAccessToken(args.accessToken)
  return null
}
