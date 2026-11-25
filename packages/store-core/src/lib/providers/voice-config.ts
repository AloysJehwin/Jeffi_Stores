import 'server-only'
import { z } from 'zod'
import { controlPlanePool, deleteIntegrationCredential, getIntegrationCredential, saveIntegrationCredential } from '@/lib/tenant-registry'
import { decryptToken, encryptToken } from '@/lib/crypto/token-cipher'
import { PLATFORM_TENANT_ID } from '@/lib/import/jobs'
import { getAnthropicIdentity } from './policy'
import { VOICE_PROVIDERS, mergeVoiceSettings, type VoiceProviderName, type VoiceSettings } from './voice-settings'

// Outreach voice config: non-secret settings from platform_provider_settings (platform default rows
// voice_provider, voice_config) plus the secrets, AES-GCM encrypted in tenant_integration_credentials under
// PLATFORM_TENANT_ID. Set from the flagship's Settings → Providers; read by voice-service through
// GET /api/internal/outreach/voice-config. Never log what this returns.

export const VOICE_CREDENTIAL_PROVIDERS = ['exotel', 'sarvam', 'azure_speech', 'twilio_voice', 'anthropic_voice'] as const
export type VoiceCredentialProvider = (typeof VOICE_CREDENTIAL_PROVIDERS)[number]

const secret = (min: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(512)
    .regex(/^[\x21-\x7e]+$/, 'No spaces or special characters')

/** Every field of each provider's stored set; PUT accepts any subset and merges it over what is stored. */
export const VOICE_CREDENTIAL_SCHEMAS = {
  exotel: z.object({ apiKey: secret(8), apiToken: secret(8) }).strict(),
  sarvam: z.object({ apiKey: secret(8) }).strict(),
  azure_speech: z.object({ apiKey: secret(16) }).strict(),
  twilio_voice: z.object({ accountSid: z.string().trim().regex(/^AC[0-9a-fA-F]{32}$/, 'An Account SID starts with AC'), authToken: secret(16) }).strict(),
  anthropic_voice: z.object({ apiKey: secret(20).refine(s => s.startsWith('sk-ant-'), 'An Anthropic key starts with sk-ant-') }).strict(),
} as const

type Creds = { [P in VoiceCredentialProvider]: z.infer<(typeof VOICE_CREDENTIAL_SCHEMAS)[P]> }

export const isVoiceCredentialProvider = (v: unknown): v is VoiceCredentialProvider =>
  VOICE_CREDENTIAL_PROVIDERS.includes(v as VoiceCredentialProvider)

export interface AnthropicVoiceIdentity {
  organizationId: string
  workspaceId: string
  serviceAccountId: string
  federationRuleId: string
}

export interface SecretStatus {
  configured: boolean
  last4: string | null
}

export interface VoiceConfig extends Omit<VoiceSettings, 'exotel' | 'sarvam' | 'azureSpeech'> {
  provider: VoiceProviderName
  exotel: VoiceSettings['exotel'] & { apiKey: string | null; apiToken: string | null; configured: boolean }
  twilioTest: VoiceSettings['twilioTest'] & {
    accountSid: string | null
    authToken: string | null
    /** stored = twilio_voice credentials; messaging = the platform's Twilio env credentials. */
    source: 'stored' | 'messaging' | null
    configured: boolean
  }
  sarvam: VoiceSettings['sarvam'] & { apiKey: string | null; configured: boolean }
  /** Azure AI Speech: the alternative STT/TTS engine, and Sarvam's fallback (see `speech`). */
  azureSpeech: VoiceSettings['azureSpeech'] & { apiKey: string | null; configured: boolean }
  anthropic: { apiKey: string | null; source: 'stored' | 'env' | null; federation: boolean; configured: boolean }
  /** Workload-identity federation for Claude (the platform's ai_provider_identities row + ANTHROPIC_ORGANIZATION_ID). Preferred over the key. */
  anthropicIdentity: AnthropicVoiceIdentity | null
  /** The chosen call provider, at least one speech engine (Sarvam or Azure) and Claude all have what they need. */
  ready: boolean
}

export interface VoiceConfigPublic extends Omit<VoiceSettings, 'exotel' | 'sarvam' | 'azureSpeech'> {
  provider: VoiceProviderName
  exotel: VoiceSettings['exotel'] & { apiKey: SecretStatus; apiToken: SecretStatus; configured: boolean }
  twilioTest: VoiceSettings['twilioTest'] & {
    accountSid: SecretStatus
    authToken: SecretStatus
    source: 'stored' | 'messaging' | null
    configured: boolean
  }
  sarvam: VoiceSettings['sarvam'] & { apiKey: SecretStatus; configured: boolean }
  azureSpeech: VoiceSettings['azureSpeech'] & { apiKey: SecretStatus; configured: boolean }
  anthropic: { apiKey: SecretStatus; source: 'stored' | 'env' | null; federation: boolean; configured: boolean }
  ready: boolean
}

/** Last 4 characters, only when the secret is long enough that they give little away. */
export const last4 = (s: string | null | undefined): string | null => (s && s.length >= 12 ? s.slice(-4) : null)

async function readStored<P extends VoiceCredentialProvider>(provider: P): Promise<{ present: boolean; value: Partial<Creds[P]> }> {
  const row = await getIntegrationCredential(PLATFORM_TENANT_ID, provider)
  if (!row) return { present: false, value: {} }
  try {
    const v = JSON.parse(decryptToken(row.config_enc))
    return { present: true, value: v && typeof v === 'object' ? v : {} }
  } catch {
    console.warn(`[voice-config] stored ${provider} credentials could not be decrypted`)
    return { present: true, value: {} }
  }
}

async function readSettings(): Promise<{ provider: VoiceProviderName; settings: VoiceSettings }> {
  const r = await controlPlanePool().query<{ key: string; value: unknown }>(
    `SELECT key, value FROM platform_provider_settings
      WHERE tenant_id IS NULL AND key IN ('voice_provider', 'voice_config')`
  )
  const m = new Map(r.rows.map(x => [x.key, x.value]))
  const p = m.get('voice_provider')
  return {
    provider: VOICE_PROVIDERS.includes(p as VoiceProviderName) ? (p as VoiceProviderName) : 'exotel',
    settings: mergeVoiceSettings(m.get('voice_config')),
  }
}

/** Non-secret settings over the defaults, the decrypted secrets, and whether each part is usable. */
export async function getVoiceConfig(): Promise<VoiceConfig> {
  const [{ provider, settings }, exotel, sarvam, azure, twilio, anthropic, identity] = await Promise.all([
    readSettings(),
    readStored('exotel'),
    readStored('sarvam'),
    readStored('azure_speech'),
    readStored('twilio_voice'),
    readStored('anthropic_voice'),
    getAnthropicIdentity(null),
  ])

  const ex = settings.exotel
  const exotelReady = !!(ex.accountSid && ex.callerId && ex.appId && exotel.value.apiKey && exotel.value.apiToken)

  const storedTwilio = !!(twilio.value.accountSid && twilio.value.authToken)
  const envSid = process.env.TWILIO_ACCOUNT_SID || null
  const envToken = process.env.TWILIO_AUTH_TOKEN || null
  const tw = storedTwilio
    ? { accountSid: twilio.value.accountSid!, authToken: twilio.value.authToken!, source: 'stored' as const }
    : envSid && envToken
      ? { accountSid: envSid, authToken: envToken, source: 'messaging' as const }
      : { accountSid: null, authToken: null, source: null }
  const twilioReady = !!(tw.source && settings.twilioTest.from && settings.testNumbers.length)

  const sarvamReady = !!sarvam.value.apiKey
  const azureReady = !!azure.value.apiKey
  const envClaude = process.env.ANTHROPIC_API_KEY || null
  const claudeKey = anthropic.value.apiKey || envClaude
  const organizationId = process.env.ANTHROPIC_ORGANIZATION_ID?.trim() || ''
  const anthropicIdentity: AnthropicVoiceIdentity | null = identity && organizationId ? { organizationId, ...identity } : null
  const claudeSource = anthropic.value.apiKey ? ('stored' as const) : envClaude ? ('env' as const) : null

  return {
    ...settings,
    provider,
    exotel: { ...ex, apiKey: exotel.value.apiKey ?? null, apiToken: exotel.value.apiToken ?? null, configured: exotelReady },
    twilioTest: { ...settings.twilioTest, ...tw, configured: twilioReady },
    sarvam: { ...settings.sarvam, apiKey: sarvam.value.apiKey ?? null, configured: sarvamReady },
    azureSpeech: { ...settings.azureSpeech, apiKey: azure.value.apiKey ?? null, configured: azureReady },
    anthropic: { apiKey: claudeKey, source: claudeSource, federation: !!anthropicIdentity, configured: !!claudeKey || !!anthropicIdentity },
    anthropicIdentity,
    ready: (provider === 'exotel' ? exotelReady : twilioReady) && (sarvamReady || azureReady) && (!!claudeKey || !!anthropicIdentity),
  }
}

const status = (v: string | null, fromEnv = false): SecretStatus => ({ configured: !!v, last4: fromEnv ? null : last4(v) })

/** getVoiceConfig for the admin UI: every secret reduced to { configured, last4 }; env values show no digits. */
export async function getVoiceConfigPublic(): Promise<VoiceConfigPublic> {
  const c = await getVoiceConfig()
  const twEnv = c.twilioTest.source === 'messaging'
  return {
    provider: c.provider,
    exotel: {
      accountSid: c.exotel.accountSid,
      subdomain: c.exotel.subdomain,
      callerId: c.exotel.callerId,
      appId: c.exotel.appId,
      apiKey: status(c.exotel.apiKey),
      apiToken: status(c.exotel.apiToken),
      configured: c.exotel.configured,
    },
    twilioTest: {
      from: c.twilioTest.from,
      accountSid: status(c.twilioTest.accountSid, twEnv),
      authToken: status(c.twilioTest.authToken, twEnv),
      source: c.twilioTest.source,
      configured: c.twilioTest.configured,
    },
    testNumbers: c.testNumbers,
    sarvam: {
      sttModel: c.sarvam.sttModel,
      ttsModel: c.sarvam.ttsModel,
      voices: c.sarvam.voices,
      apiKey: status(c.sarvam.apiKey),
      configured: c.sarvam.configured,
    },
    speech: c.speech,
    azureSpeech: {
      region: c.azureSpeech.region,
      voices: c.azureSpeech.voices,
      apiKey: status(c.azureSpeech.apiKey),
      configured: c.azureSpeech.configured,
    },
    llmModel: c.llmModel,
    anthropic: {
      apiKey: status(c.anthropic.apiKey, c.anthropic.source === 'env'),
      source: c.anthropic.source,
      federation: c.anthropic.federation,
      configured: c.anthropic.configured,
    },
    ready: c.ready,
  }
}

export class VoiceCredentialError extends Error {}

/** Merges `values` over the stored set, validates the result and stores it encrypted. Returns the masked status. */
export async function saveVoiceCredential(provider: VoiceCredentialProvider, values: unknown): Promise<Record<string, SecretStatus>> {
  const schema = VOICE_CREDENTIAL_SCHEMAS[provider]
  const partial = (schema as z.ZodObject<any>).partial().safeParse(values)
  if (!partial.success) throw new VoiceCredentialError(partial.error.issues[0]?.message || 'Invalid credentials')
  const given = Object.fromEntries(Object.entries(partial.data).filter(([, v]) => v !== undefined && v !== ''))
  if (!Object.keys(given).length) throw new VoiceCredentialError('Nothing to save')
  const stored = await readStored(provider)
  const full = schema.safeParse({ ...stored.value, ...given })
  if (!full.success) {
    const missing = Object.keys(schema.shape).filter(k => !(k in stored.value) && !(k in given))
    throw new VoiceCredentialError(missing.length ? `Also enter: ${missing.join(', ')}` : full.error.issues[0]?.message || 'Invalid credentials')
  }
  await saveIntegrationCredential({
    tenantId: PLATFORM_TENANT_ID,
    provider,
    label: 'Outreach voice',
    configEnc: encryptToken(JSON.stringify(full.data)),
    meta: { scope: 'outreach' },
  })
  return Object.fromEntries(Object.entries(full.data).map(([k, v]) => [k, status(v as string)]))
}

export async function clearVoiceCredential(provider: VoiceCredentialProvider): Promise<void> {
  await deleteIntegrationCredential(PLATFORM_TENANT_ID, provider)
}

export interface ProviderTestResult {
  ok: boolean
  message: string
}

/** Read-only check of the saved Exotel credentials: GET the account balance. Places no call. */
export async function testExotelCredentials(): Promise<ProviderTestResult> {
  const c = await getVoiceConfig()
  const { accountSid, subdomain, apiKey, apiToken } = c.exotel
  if (!accountSid || !apiKey || !apiToken) return { ok: false, message: 'Save the Account SID, API key and API token first.' }
  const auth = Buffer.from(`${apiKey}:${apiToken}`).toString('base64')
  try {
    const r = await fetch(`https://${subdomain}/v1/Accounts/${encodeURIComponent(accountSid)}/Balance.json`, {
      headers: { authorization: `Basic ${auth}`, accept: 'application/json' },
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    })
    if (r.ok) return { ok: true, message: `Exotel accepted the credentials (${subdomain}).` }
    if (r.status === 401 || r.status === 403) return { ok: false, message: 'Exotel rejected the API key or token.' }
    if (r.status === 404) return { ok: false, message: `No account ${accountSid} on ${subdomain}. Check the SID and region.` }
    return { ok: false, message: `Exotel answered ${r.status}.` }
  } catch {
    return { ok: false, message: 'Exotel did not answer.' }
  }
}

/** Read-only check of the saved Azure Speech key: asks the region's token endpoint for a 10-minute token. Speaks and transcribes nothing. */
export async function testAzureSpeechCredentials(): Promise<ProviderTestResult> {
  const c = await getVoiceConfig()
  const { apiKey, region } = c.azureSpeech
  if (!apiKey) return { ok: false, message: 'Save the Azure Speech key first.' }
  try {
    const r = await fetch(`https://${encodeURIComponent(region)}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, {
      method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': apiKey, 'content-length': '0' },
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    })
    if (r.ok) return { ok: true, message: `Azure Speech accepted the key (${region}).` }
    if (r.status === 401 || r.status === 403) return { ok: false, message: `Azure Speech rejected the key for ${region}. Check the key and the region.` }
    return { ok: false, message: `Azure Speech answered ${r.status}.` }
  } catch {
    return { ok: false, message: 'Azure Speech did not answer.' }
  }
}
