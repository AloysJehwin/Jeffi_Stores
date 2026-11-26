import 'server-only'
import { controlPlanePool } from '@/lib/tenant-registry'
import { getAnthropicIdentity } from './policy'
import { VOICE_PROVIDERS, mergeVoiceSettings, type VoiceProviderName, type VoiceSettings } from './voice-settings'

// Outreach voice config: the non-secret settings from platform_provider_settings (platform default rows
// voice_provider, voice_config). Every credential comes from the platform's secrets (env) and is never stored,
// shown or sent: voice-service reads its own copy of the same secrets. Only names and presence leave this file.

export interface VoiceSecretStatus {
  name: string
  group: 'calling' | 'voice'
  present: boolean
}

const VOICE_SECRET_NAMES: { name: string; group: VoiceSecretStatus['group'] }[] = [
  { name: 'EXOTEL_API_KEY', group: 'calling' },
  { name: 'EXOTEL_API_TOKEN', group: 'calling' },
  { name: 'TWILIO_ACCOUNT_SID', group: 'calling' },
  { name: 'TWILIO_AUTH_TOKEN', group: 'calling' },
  { name: 'SARVAM_API_KEY', group: 'voice' },
  { name: 'AZURE_SPEECH_KEY', group: 'voice' },
  { name: 'ANTHROPIC_API_KEY', group: 'voice' },
]

const env = (name: string) => process.env[name]?.trim() || ''

/** Names and presence of the voice secrets, never values. */
export function voiceSecretsStatus(): VoiceSecretStatus[] {
  return VOICE_SECRET_NAMES.map(s => ({ ...s, present: !!env(s.name) }))
}

export interface AnthropicVoiceIdentity {
  organizationId: string
  workspaceId: string
  serviceAccountId: string
  federationRuleId: string
}

export interface VoiceConfigView extends VoiceSettings {
  /** The chosen call provider (the Calling provider). */
  provider: VoiceProviderName
  /** Workload-identity federation for Claude (the platform's ai_provider_identities row + ANTHROPIC_ORGANIZATION_ID). Preferred over ANTHROPIC_API_KEY. */
  anthropicIdentity: AnthropicVoiceIdentity | null
  parts: {
    /** Exotel: account SID, caller number, app id and its two secrets. */
    exotel: boolean
    /** Twilio test line: from-number, at least one test number and its two secrets. */
    twilio: boolean
    /** The chosen call provider's part. */
    calling: boolean
    sarvam: boolean
    azure: boolean
    /** Sarvam or Azure: one speech engine is enough. */
    speech: boolean
    /** Federation or ANTHROPIC_API_KEY. */
    claude: boolean
  }
  /** The chosen call provider, one speech engine and Claude all have what they need. */
  ready: boolean
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

/** The non-secret config plus per-part readiness computed from it and from which secrets are set. This is also what voice-service is sent. */
export async function getVoiceConfigView(): Promise<VoiceConfigView> {
  const [{ provider, settings }, identity] = await Promise.all([readSettings(), getAnthropicIdentity()])
  const ex = settings.exotel
  const exotel = !!(ex.accountSid && ex.callerId && ex.appId && env('EXOTEL_API_KEY') && env('EXOTEL_API_TOKEN'))
  const twilio = !!(env('TWILIO_ACCOUNT_SID') && env('TWILIO_AUTH_TOKEN') && settings.twilioTest.from && settings.testNumbers.length)
  const sarvam = !!env('SARVAM_API_KEY')
  const azure = !!env('AZURE_SPEECH_KEY')
  const organizationId = env('ANTHROPIC_ORGANIZATION_ID')
  const anthropicIdentity: AnthropicVoiceIdentity | null = identity && organizationId ? { organizationId, ...identity } : null
  const claude = !!env('ANTHROPIC_API_KEY') || !!anthropicIdentity
  const calling = provider === 'exotel' ? exotel : twilio
  const speech = sarvam || azure
  return {
    ...settings,
    provider,
    anthropicIdentity,
    parts: { exotel, twilio, calling, sarvam, azure, speech, claude },
    ready: calling && speech && claude,
  }
}

export interface ProviderTestResult {
  ok: boolean
  message: string
}

const FETCH = { redirect: 'manual', cache: 'no-store' } as const

/** Read-only check of the Exotel secrets: GET the account balance. Places no call. */
export async function testExotelCredentials(): Promise<ProviderTestResult> {
  const { settings } = await readSettings()
  const { accountSid, subdomain } = settings.exotel
  const key = env('EXOTEL_API_KEY')
  const token = env('EXOTEL_API_TOKEN')
  if (!key || !token) return { ok: false, message: 'EXOTEL_API_KEY and EXOTEL_API_TOKEN are not set in the platform secrets.' }
  if (!accountSid) return { ok: false, message: 'Set the Exotel account SID first.' }
  const auth = Buffer.from(`${key}:${token}`).toString('base64')
  try {
    const r = await fetch(`https://${subdomain}/v1/Accounts/${encodeURIComponent(accountSid)}/Balance.json`, {
      headers: { authorization: `Basic ${auth}`, accept: 'application/json' },
      ...FETCH,
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

/** Read-only check of the Twilio secrets: GET the account. Places no call. */
export async function testTwilioCredentials(): Promise<ProviderTestResult> {
  const sid = env('TWILIO_ACCOUNT_SID')
  const token = env('TWILIO_AUTH_TOKEN')
  if (!sid || !token) return { ok: false, message: 'TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are not set in the platform secrets.' }
  try {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}.json`, {
      headers: { authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`, accept: 'application/json' },
      ...FETCH,
      signal: AbortSignal.timeout(8000),
    })
    if (r.ok) return { ok: true, message: 'Twilio accepted the credentials.' }
    if (r.status === 401 || r.status === 403) return { ok: false, message: 'Twilio rejected the account SID or auth token.' }
    return { ok: false, message: `Twilio answered ${r.status}.` }
  } catch {
    return { ok: false, message: 'Twilio did not answer.' }
  }
}

/** Check of AZURE_SPEECH_KEY: asks the region's token endpoint for a 10-minute token. Speaks and transcribes nothing. */
export async function testAzureSpeechCredentials(): Promise<ProviderTestResult> {
  const { settings } = await readSettings()
  const { region } = settings.azureSpeech
  const key = env('AZURE_SPEECH_KEY')
  if (!key) return { ok: false, message: 'AZURE_SPEECH_KEY is not set in the platform secrets.' }
  try {
    const r = await fetch(`https://${encodeURIComponent(region)}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, {
      method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': key, 'content-length': '0' },
      ...FETCH,
      signal: AbortSignal.timeout(8000),
    })
    if (r.ok) return { ok: true, message: `Azure Speech accepted the key (${region}).` }
    if (r.status === 401 || r.status === 403) return { ok: false, message: `Azure Speech rejected the key for ${region}. Check the key and the region.` }
    return { ok: false, message: `Azure Speech answered ${r.status}.` }
  } catch {
    return { ok: false, message: 'Azure Speech did not answer.' }
  }
}

/** Check of SARVAM_API_KEY. Sarvam has no read-only endpoint, so this posts an empty body: a bad key is refused (401/403) before validation, a good one gets a 4xx validation error and nothing is synthesised or billed. */
export async function testSarvamCredentials(): Promise<ProviderTestResult> {
  const key = env('SARVAM_API_KEY')
  if (!key) return { ok: false, message: 'SARVAM_API_KEY is not set in the platform secrets.' }
  try {
    const r = await fetch('https://api.sarvam.ai/text-to-speech', {
      method: 'POST',
      headers: { 'api-subscription-key': key, 'content-type': 'application/json' },
      body: '{}',
      ...FETCH,
      signal: AbortSignal.timeout(8000),
    })
    if (r.status === 401 || r.status === 403) return { ok: false, message: 'Sarvam rejected the API key.' }
    if (r.status === 400 || r.status === 422 || r.ok) return { ok: true, message: 'Sarvam accepted the API key.' }
    return { ok: false, message: `Sarvam answered ${r.status}.` }
  } catch {
    return { ok: false, message: 'Sarvam did not answer.' }
  }
}
