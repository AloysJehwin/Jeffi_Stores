const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''

export interface GoogleTokenPayload {
  sub: string
  email: string
  given_name?: string
  family_name?: string
  name?: string
  picture?: string
  aud?: string | string[]
}

export async function verifyGoogleToken(idToken: string): Promise<GoogleTokenPayload | null> {
  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`)
    if (!res.ok) return null
    const data = await res.json()
    if (!data.sub || !data.email) return null
    if (GOOGLE_CLIENT_ID) {
      const aud = Array.isArray(data.aud) ? data.aud : [data.aud]
      if (!aud.includes(GOOGLE_CLIENT_ID)) return null
    }
    return data as GoogleTokenPayload
  } catch (err) {
    console.error('[google-verify]', err)
    return null
  }
}

export async function verifyGoogleAccessToken(accessToken: string): Promise<GoogleTokenPayload | null> {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return null
    const data = await res.json()
    if (!data.sub || !data.email || data.email_verified === false) return null
    return {
      sub: data.sub,
      email: data.email,
      given_name: data.given_name,
      family_name: data.family_name,
      name: data.name,
      picture: data.picture,
    }
  } catch (err) {
    console.error('[google-verify]', err)
    return null
  }
}

export async function verifyGoogleCredential(
  idToken?: string,
  accessToken?: string
): Promise<GoogleTokenPayload | null> {
  if (idToken) return verifyGoogleToken(idToken)
  if (accessToken) return verifyGoogleAccessToken(accessToken)
  return null
}
