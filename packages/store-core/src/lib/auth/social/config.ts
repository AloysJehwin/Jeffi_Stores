import {
  deleteIntegrationCredential,
  getIntegrationCredential,
  listIntegrationCredentials,
  saveIntegrationCredential,
} from '@/lib/tenant-registry'
import { decryptToken, encryptToken } from '@/lib/crypto/token-cipher'
import { SOCIAL_LABEL, SOCIAL_PROVIDERS, type SignInMethod, type SocialCredentials, type SocialProvider } from './types'

// A store's customer sign-in methods: one tenant_integration_credentials row per provider
// (`login_<provider>`). The app's secrets are encrypted in config_enc; the on/off switch and the
// non-secret ids live in meta. No row: Google runs on the platform client, the others are off.

const keyOf = (p: SocialProvider) => `login_${p}`
const providerOfKey = (k: string) => SOCIAL_PROVIDERS.find(p => keyOf(p) === k)

export const platformGoogleClientId = () => process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || ''

export interface SignInMethodAdminView {
  provider: SocialProvider
  enabled: boolean
  configured: boolean
  clientId: string
  teamId: string
  keyId: string
  secretLast4: string
}

interface Meta {
  enabled?: boolean
  configured?: boolean
  client_id?: string
  team_id?: string
  key_id?: string
  secret_last4?: string
}

function isComplete(p: SocialProvider, c: Partial<SocialCredentials> | null | undefined): c is SocialCredentials {
  if (!c?.clientId) return false
  return p === 'apple' ? !!(c.teamId && c.keyId && c.privateKey) : !!c.clientSecret
}

function view(p: SocialProvider, meta: Meta | null): SignInMethodAdminView {
  return {
    provider: p,
    // Google is on until switched off; the rest are off until switched on.
    enabled: meta?.enabled ?? p === 'google',
    configured: !!meta?.configured,
    clientId: meta?.client_id || '',
    teamId: meta?.team_id || '',
    keyId: meta?.key_id || '',
    secretLast4: meta?.secret_last4 || '',
  }
}

export async function listSignInMethodsAdmin(tenantId: string): Promise<SignInMethodAdminView[]> {
  const rows = await listIntegrationCredentials(tenantId)
  const byProvider = new Map<SocialProvider, Meta>()
  for (const r of rows) {
    const p = providerOfKey(r.provider)
    if (p) byProvider.set(p, (r.meta || {}) as Meta)
  }
  return SOCIAL_PROVIDERS.map(p => view(p, byProvider.get(p) ?? null))
}

/** What the store's login pages offer. No secrets. */
export async function listSignInMethods(tenantId: string): Promise<SignInMethod[]> {
  const all = await listSignInMethodsAdmin(tenantId).catch(() => SOCIAL_PROVIDERS.map(p => view(p, null)))
  const out: SignInMethod[] = []
  for (const m of all) {
    if (!m.enabled) continue
    if (m.configured) out.push({ id: m.provider, label: SOCIAL_LABEL[m.provider], flow: 'redirect' })
    else if (m.provider === 'google' && platformGoogleClientId())
      out.push({ id: 'google', label: SOCIAL_LABEL.google, flow: 'google_platform' })
  }
  return out
}

async function readRow(tenantId: string, p: SocialProvider): Promise<{ meta: Meta; creds: Partial<SocialCredentials> } | null> {
  const row = await getIntegrationCredential(tenantId, keyOf(p)).catch(() => null)
  if (!row) return null
  let creds: Partial<SocialCredentials> = {}
  try {
    creds = JSON.parse(decryptToken(row.config_enc)) || {}
  } catch {}
  return { meta: (row.meta || {}) as Meta, creds }
}

/** The store's own app for a provider, only while it is switched on and fully configured. */
export async function readSocialCredentials(tenantId: string, p: SocialProvider): Promise<SocialCredentials | null> {
  const row = await readRow(tenantId, p)
  if (!row || !(row.meta.enabled ?? p === 'google')) return null
  return isComplete(p, row.creds) ? row.creds : null
}

const PEM_RE = /^-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----$/

export interface SignInMethodInput {
  enabled?: boolean
  clientId?: string
  clientSecret?: string
  teamId?: string
  keyId?: string
  privateKey?: string
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/**
 * Save the switch and/or the app. Secret fields left blank keep the stored secret. Returns an error
 * message for invalid input.
 */
export async function saveSignInMethod(
  tenantId: string,
  p: SocialProvider,
  input: SignInMethodInput
): Promise<{ ok: true; method: SignInMethodAdminView } | { ok: false; error: string }> {
  const existing = await readRow(tenantId, p)
  const prev = existing?.creds ?? {}
  const touchesApp = ['clientId', 'clientSecret', 'teamId', 'keyId', 'privateKey'].some(k => str((input as any)[k]) !== '')
  let creds: Partial<SocialCredentials> = prev

  if (touchesApp) {
    const clientId = str(input.clientId) || prev.clientId || ''
    if (!clientId) return { ok: false, error: p === 'apple' ? 'Services ID is required' : p === 'facebook' ? 'App ID is required' : 'Client ID is required' }
    if (/\s/.test(clientId) || clientId.length > 255) return { ok: false, error: 'That ID does not look right' }
    if (p === 'facebook' && !/^\d{5,25}$/.test(clientId)) return { ok: false, error: 'The Facebook app ID is digits only' }
    if (p === 'apple') {
      const teamId = str(input.teamId) || prev.teamId || ''
      const keyId = str(input.keyId) || prev.keyId || ''
      const privateKey = str(input.privateKey).replace(/\r\n/g, '\n') || prev.privateKey || ''
      if (!/^[A-Z0-9]{10}$/i.test(teamId)) return { ok: false, error: 'The Apple Team ID is 10 letters and digits' }
      if (!/^[A-Z0-9]{10}$/i.test(keyId)) return { ok: false, error: 'The Apple Key ID is 10 letters and digits' }
      if (!PEM_RE.test(privateKey)) return { ok: false, error: 'Paste the whole .p8 key, including the BEGIN and END PRIVATE KEY lines' }
      creds = { clientId, teamId: teamId.toUpperCase(), keyId: keyId.toUpperCase(), privateKey }
    } else {
      const clientSecret = str(input.clientSecret) || prev.clientSecret || ''
      if (!clientSecret) return { ok: false, error: p === 'facebook' ? 'App secret is required' : 'Client secret is required' }
      if (/\s/.test(clientSecret) || clientSecret.length > 512) return { ok: false, error: 'That secret does not look right' }
      creds = { clientId, clientSecret }
    }
  }

  const configured = isComplete(p, creds)
  const enabled = typeof input.enabled === 'boolean' ? input.enabled : (existing?.meta.enabled ?? (p === 'google' || configured))
  if (enabled && !configured && p !== 'google') return { ok: false, error: 'Add the app details before switching this on' }

  const secret = p === 'apple' ? '' : creds.clientSecret || ''
  const meta: Meta = {
    enabled,
    configured,
    client_id: creds.clientId || '',
    team_id: creds.teamId || '',
    key_id: creds.keyId || '',
    secret_last4: secret ? secret.slice(-4) : '',
  }
  await saveIntegrationCredential({
    tenantId,
    provider: keyOf(p),
    label: `${SOCIAL_LABEL[p]} sign-in`,
    configEnc: encryptToken(JSON.stringify(configured ? creds : {})),
    meta,
  })
  return { ok: true, method: view(p, meta) }
}

/** Remove the store's own app. Google falls back to the platform client (and stays off if it was off). */
export async function removeSignInMethod(tenantId: string, p: SocialProvider): Promise<SignInMethodAdminView> {
  const existing = await readRow(tenantId, p)
  if (p === 'google' && existing && existing.meta.enabled === false) {
    const meta: Meta = { enabled: false, configured: false }
    await saveIntegrationCredential({
      tenantId,
      provider: keyOf(p),
      label: `${SOCIAL_LABEL[p]} sign-in`,
      configEnc: encryptToken('{}'),
      meta,
    })
    return view(p, meta)
  }
  await deleteIntegrationCredential(tenantId, keyOf(p))
  return view(p, null)
}
