'use client'

import { type ReactNode, useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import Select from '@/components/ui/Select'
import { Badge, Banner, api, btnGhost, btnPrimary, inputCls } from '@/components/admin/kit/core'
import { useActionToast } from '@/components/admin/kit/toast'
import type { SecretStatus, VoiceConfigPublic } from '@/lib/providers/voice-config'
import type { SmsDltConfig } from '@/lib/providers/sms-dlt'
import {
  DEFAULT_SARVAM_VOICES,
  DEFAULT_VOICE_LLM,
  EXOTEL_SUBDOMAINS,
  EXOTEL_TM_ID,
  MAX_SENDER_IDS,
  MAX_TEST_NUMBERS,
  SARVAM_STT_MODELS,
  SARVAM_TTS_MODELS,
  VOICE_LANGS,
  type StoredVoiceConfig,
  type VoiceLang,
  isE164,
  normalizeDltEntityId,
  normalizeSenderId,
  normalizeVoiceConfig,
} from '@/lib/providers/voice-settings'
import { SectionCard } from './controls'

// Flagship administrator only (Settings → Providers): the Outreach program's call, voice AI and India SMS DLT
// providers. Non-secret fields save through PUT /api/admin/settings/providers; secrets are write-only and save
// through /api/admin/settings/providers/credentials, which never returns them.

type Data = { voice: VoiceConfigPublic; dlt: SmsDltConfig }
type Patch = Partial<StoredVoiceConfig>

const LANG_LABEL: Record<VoiceLang, string> = {
  en: 'English',
  hi: 'Hindi',
  ta: 'Tamil',
  te: 'Telugu',
  kn: 'Kannada',
  ml: 'Malayalam',
  mr: 'Marathi',
  bn: 'Bengali',
  gu: 'Gujarati',
}
const REGION_LABEL: Record<string, string> = { 'api.in.exotel.com': 'Mumbai (api.in.exotel.com)', 'api.exotel.com': 'Singapore (api.exotel.com)' }
const MODEL_LABEL: Record<string, string> = { 'saaras:v3': 'Saaras v3', 'saaras:v4': 'Saaras v4', 'bulbul:v3': 'Bulbul v3', 'bulbul:v2': 'Bulbul v2' }

const valid = (cfg: StoredVoiceConfig) => normalizeVoiceConfig(cfg) !== null
const mask = (s: SecretStatus) => (s.configured ? (s.last4 ? `Configured · ••••${s.last4}` : 'Configured') : 'Not set')

/** The non-secret part of the loaded config, the base every section's save is merged over. */
function storedOf(v: VoiceConfigPublic): StoredVoiceConfig {
  return {
    exotel: { accountSid: v.exotel.accountSid, subdomain: v.exotel.subdomain, callerId: v.exotel.callerId, appId: v.exotel.appId },
    twilioTest: { from: v.twilioTest.from },
    testNumbers: v.testNumbers,
    sarvam: { sttModel: v.sarvam.sttModel, ttsModel: v.sarvam.ttsModel, voices: v.sarvam.voices },
    llmModel: v.llmModel,
  }
}

export default function OutreachProvidersCard({ owner }: { owner: boolean }) {
  return owner ? <OutreachProviders /> : null
}

function OutreachProviders() {
  const canWrite = useCanWrite('settings:write')
  const toast = useActionToast()
  const [data, setData] = useState<Data | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  async function load() {
    const { ok, data: d } = await api<Data>('/api/admin/settings/providers/credentials')
    if (ok) setData(d)
    else setLoadError(d.error || 'Could not load the Outreach providers')
  }
  useEffect(() => {
    load()
  }, [])

  async function saveSetting(key: string, value: unknown, label: string) {
    const { ok, data: d } = await api('/api/admin/settings/providers', { method: 'PUT', json: { tenantId: null, key, value } })
    toast.result({ ok, text: ok ? `${label} saved` : d.error || 'Save failed' })
    if (ok) await load()
    return ok
  }
  async function clearSetting(key: string, label: string) {
    const { ok, data: d } = await api(`/api/admin/settings/providers?${new URLSearchParams({ key })}`, { method: 'DELETE' })
    toast.result({ ok, text: ok ? `${label} cleared` : d.error || 'Reset failed' })
    if (ok) await load()
  }
  const saveVoice = (patch: Patch, label: string) => saveSetting('voice_config', { ...storedOf(data!.voice), ...patch }, label)

  return (
    <SectionCard
      title="Outreach providers"
      description="Calls, voice AI and India SMS DLT for the Outreach program. Secrets are stored encrypted, shown only as their last 4 characters, and override the environment."
    >
      {loadError && !data && <Banner ok={false}>{loadError}</Banner>}
      {!data ? (
        <OutreachSkeleton />
      ) : (
        <>
          <Calling data={data} disabled={!canWrite} saveSetting={saveSetting} saveVoice={saveVoice} reload={load} />
          <VoiceAi data={data} disabled={!canWrite} saveVoice={saveVoice} reload={load} />
          <Dlt data={data} disabled={!canWrite} saveSetting={saveSetting} clearSetting={clearSetting} />
        </>
      )}
    </SectionCard>
  )
}

function Part({ title, status, children }: { title: string; status?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">{title}</h3>
        {status}
      </div>
      {children}
    </div>
  )
}

function Box({ title, status, children }: { title: string; status?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border-default p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-foreground">{title}</span>
        {status}
      </div>
      {children}
    </div>
  )
}

const ready = (ok: boolean, label = ok ? 'Ready' : 'Incomplete') => <Badge tone={ok ? 'green' : 'amber'}>{label}</Badge>

function Field({
  label,
  help,
  value,
  onChange,
  error,
  placeholder,
  disabled,
}: {
  label: string
  help: string
  value: string
  onChange: (v: string) => void
  error?: string | null
  placeholder?: string
  disabled?: boolean
}) {
  return (
    <label className="block">
      <span className="block text-xs text-foreground-muted mb-1">{label}</span>
      <input
        className={inputCls}
        aria-label={label}
        aria-invalid={!!error}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        spellCheck={false}
        onChange={e => onChange(e.target.value)}
      />
      {error ? <span className="block text-xs text-red-600 mt-1">{error}</span> : <span className="block text-xs text-foreground-muted mt-1">{help}</span>}
    </label>
  )
}

function SelectField({
  label,
  help,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string
  help: string
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
  disabled?: boolean
}) {
  return (
    <div>
      <span className="block text-xs text-foreground-muted mb-1">{label}</span>
      <Select aria-label={label} value={value} disabled={disabled} onChange={onChange} options={options} />
      <span className="block text-xs text-foreground-muted mt-1">{help}</span>
    </div>
  )
}

function SaveRow({ disabled, onSave, label = 'Save' }: { disabled: boolean; onSave: () => void; label?: string }) {
  return (
    <div>
      <button type="button" className={btnPrimary} disabled={disabled} onClick={onSave}>
        {label}
      </button>
    </div>
  )
}

/** Write-only secrets of one provider: masked status, Replace / Remove, and inputs only while editing. */
function SecretGroup({
  provider,
  title,
  help,
  fields,
  statuses,
  stored,
  fallback,
  disabled,
  onChanged,
}: {
  provider: 'exotel' | 'sarvam' | 'twilio_voice' | 'anthropic_voice'
  title: string
  help: string
  fields: { key: string; label: string }[]
  statuses: Record<string, SecretStatus>
  /** A stored row exists (Replace / Remove); otherwise the inputs show straight away. */
  stored: boolean
  /** Shown while nothing is stored, e.g. the env credentials in use. */
  fallback?: string
  disabled: boolean
  onChanged: () => Promise<void> | void
}) {
  const toast = useActionToast()
  const [editing, setEditing] = useState(false)
  const [values, setValues] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const open = !disabled && (editing || !stored)
  const filled = Object.values(values).some(v => v.trim())

  async function save() {
    const given = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim()))
    setBusy(true)
    const { ok, data } = await api('/api/admin/settings/providers/credentials', { method: 'PUT', json: { provider, values: given } })
    setBusy(false)
    if (!ok) return setError(data.error || 'Save failed')
    setValues({})
    setError(null)
    setEditing(false)
    toast.success(`${title} saved`)
    await onChanged()
  }

  async function remove() {
    const { ok, data } = await api(`/api/admin/settings/providers/credentials?${new URLSearchParams({ provider })}`, { method: 'DELETE' })
    toast.result({ ok, text: ok ? `${title} removed` : data.error || 'Remove failed' })
    if (ok) await onChanged()
  }

  return (
    <div className="space-y-2" data-testid={`secret-${provider}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-foreground">{title}</span>
        {stored && !open && !disabled && (
          <div className="flex gap-2">
            <button type="button" className={btnGhost} onClick={() => setEditing(true)}>
              Replace
            </button>
            <button type="button" className={btnGhost} onClick={remove} aria-label={`Remove ${title}`} title="Remove">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
      <ul className="space-y-1">
        {fields.map(f => (
          <li key={f.key} className="flex items-center gap-2 text-sm">
            <span className="text-foreground-muted w-32 shrink-0">{f.label}</span>
            {open ? (
              <input
                type="password"
                className={inputCls}
                aria-label={f.label}
                autoComplete="new-password"
                spellCheck={false}
                placeholder={stored ? 'Leave blank to keep' : ''}
                value={values[f.key] ?? ''}
                onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
              />
            ) : (
              <span className="text-foreground">{mask(statuses[f.key] ?? { configured: false, last4: null })}</span>
            )}
          </li>
        ))}
      </ul>
      {!stored && fallback && <p className="text-xs text-foreground-muted">{fallback}</p>}
      {error ? <p className="text-xs text-red-600">{error}</p> : <p className="text-xs text-foreground-muted">{help}</p>}
      {open && (
        <div className="flex gap-2">
          <button type="button" className={btnPrimary} disabled={!filled || busy} onClick={save}>
            Save {title}
          </button>
          {stored && (
            <button
              type="button"
              className={btnGhost}
              onClick={() => {
                setEditing(false)
                setValues({})
                setError(null)
              }}
            >
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** A short list of values (test numbers, sender headers) with add / remove and per-entry validation. */
function ListEditor({
  label,
  help,
  values,
  onChange,
  normalize,
  invalidText,
  max,
  placeholder,
  disabled,
}: {
  label: string
  help: string
  values: string[]
  onChange: (v: string[]) => void
  normalize: (v: string) => string | null
  invalidText: string
  max: number
  placeholder?: string
  disabled?: boolean
}) {
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const full = values.length >= max

  function add() {
    const v = normalize(input)
    if (!v) return setError(invalidText)
    if (full) return setError(`At most ${max}.`)
    setError(null)
    setInput('')
    if (!values.includes(v)) onChange([...values, v])
  }

  return (
    <div>
      <span className="block text-xs text-foreground-muted mb-1">{label}</span>
      {values.length > 0 && (
        <ul className="flex flex-wrap gap-2 mb-2" aria-label={label}>
          {values.map(v => (
            <li key={v} className="inline-flex items-center gap-1 rounded-md bg-surface-secondary px-2 py-1 text-sm text-foreground">
              {v}
              {!disabled && (
                <button type="button" className="p-0.5" onClick={() => onChange(values.filter(x => x !== v))} aria-label={`Remove ${v}`} title="Remove">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!disabled && (
        <div className="flex gap-2">
          <input
            className={inputCls}
            aria-label={`Add to ${label}`}
            value={input}
            placeholder={placeholder}
            disabled={full}
            spellCheck={false}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                add()
              }
            }}
          />
          <button type="button" className={btnGhost} disabled={!input.trim() || full} onClick={add}>
            Add
          </button>
        </div>
      )}
      {error ? (
        <span className="block text-xs text-red-600 mt-1">{error}</span>
      ) : (
        <span className="block text-xs text-foreground-muted mt-1">
          {help} {values.length}/{max}.
        </span>
      )}
    </div>
  )
}

const sameList = (a: string[], b: string[]) => a.join(',') === b.join(',')
const exotelOf = (e: VoiceConfigPublic['exotel']) => ({ accountSid: e.accountSid, subdomain: e.subdomain, callerId: e.callerId, appId: e.appId })

function Calling({
  data,
  disabled,
  saveSetting,
  saveVoice,
  reload,
}: {
  data: Data
  disabled: boolean
  saveSetting: (key: string, value: unknown, label: string) => Promise<boolean>
  saveVoice: (patch: Patch, label: string) => Promise<boolean>
  reload: () => Promise<void>
}) {
  const v = data.voice
  const [ex, setEx] = useState(exotelOf(v.exotel))
  const [from, setFrom] = useState(v.twilioTest.from)
  const [nums, setNums] = useState(v.testNumbers)
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null)
  const [testing, setTesting] = useState(false)
  useEffect(() => {
    setEx(exotelOf(v.exotel))
    setFrom(v.twilioTest.from)
    setNums(v.testNumbers)
  }, [v])

  const exErr = {
    accountSid: valid({ exotel: { accountSid: ex.accountSid } }) ? null : 'Letters, digits, - and _ only.',
    callerId: valid({ exotel: { callerId: ex.callerId } }) ? null : 'A phone number, e.g. +911401234567.',
    appId: valid({ exotel: { appId: ex.appId } }) ? null : 'Letters, digits, - and _ only.',
  }
  const exDirty = (['accountSid', 'subdomain', 'callerId', 'appId'] as const).some(k => ex[k] !== v.exotel[k])
  const fromErr = !from.trim() || isE164(from) ? null : 'E.164, e.g. +14155550100.'

  async function runTest() {
    setTesting(true)
    const { ok, data: d } = await api<{ ok: boolean; message: string }>('/api/admin/settings/providers/credentials/test', { method: 'POST', json: { provider: 'exotel' } })
    setTesting(false)
    setTest({ ok: ok && d.ok, message: d.message || d.error || 'Test failed' })
  }

  const exotelStored = v.exotel.apiKey.configured || v.exotel.apiToken.configured
  return (
    <Part title="Calling">
      <div className="max-w-sm">
        <SelectField
          label="Call provider"
          help="Exotel AgentStream places the real Outreach calls. The Twilio test line calls only the test numbers."
          value={v.provider}
          disabled={disabled}
          onChange={p => p !== v.provider && saveSetting('voice_provider', p, 'Call provider')}
          options={[
            { value: 'exotel', label: 'Exotel' },
            { value: 'twilio_test', label: 'Twilio test line' },
          ]}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Box title="Exotel" status={ready(v.exotel.configured)}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Account SID" help="Exotel → Settings → API settings." value={ex.accountSid} error={exErr.accountSid} disabled={disabled} onChange={s => setEx({ ...ex, accountSid: s })} />
            <SelectField
              label="Region"
              help="The API host shown beside your keys in API settings."
              value={ex.subdomain}
              disabled={disabled}
              onChange={s => setEx({ ...ex, subdomain: s as typeof ex.subdomain })}
              options={EXOTEL_SUBDOMAINS.map(d => ({ value: d, label: REGION_LABEL[d] }))}
            />
            <Field
              label="Caller number"
              help="Your 140-series ExoPhone (Exotel → ExoPhones)."
              value={ex.callerId}
              error={exErr.callerId}
              placeholder="+911401234567"
              disabled={disabled}
              onChange={s => setEx({ ...ex, callerId: s })}
            />
            <Field
              label="AgentStream app ID"
              help="The App Bazaar flow with the AgentStream applet: the number in its URL."
              value={ex.appId}
              error={exErr.appId}
              disabled={disabled}
              onChange={s => setEx({ ...ex, appId: s })}
            />
          </div>
          {!disabled && <SaveRow label="Save Exotel settings" disabled={!exDirty || Object.values(exErr).some(Boolean)} onSave={() => saveVoice({ exotel: ex }, 'Exotel settings')} />}
          <SecretGroup
            provider="exotel"
            title="Exotel API credentials"
            help="Exotel → Settings → API settings: the API key and API token."
            fields={[
              { key: 'apiKey', label: 'API key' },
              { key: 'apiToken', label: 'API token' },
            ]}
            statuses={{ apiKey: v.exotel.apiKey, apiToken: v.exotel.apiToken }}
            stored={exotelStored}
            disabled={disabled}
            onChanged={reload}
          />
          {!disabled && (
            <div className="space-y-2">
              <button type="button" className={btnGhost} disabled={!exotelStored || testing} onClick={runTest}>
                {testing ? 'Testing…' : 'Test Exotel'}
              </button>
              <p className="text-xs text-foreground-muted">Reads the account balance with the saved credentials. No call is placed.</p>
              {test && (
                <div role="status">
                  <Banner ok={test.ok}>{test.message}</Banner>
                </div>
              )}
            </div>
          )}
        </Box>
        <Box title="Twilio test line" status={ready(v.twilioTest.configured)}>
          <Field
            label="From number"
            help="A voice-capable Twilio number. It only ever calls the test numbers."
            value={from}
            error={fromErr}
            placeholder="+14155550100"
            disabled={disabled}
            onChange={setFrom}
          />
          {!disabled && <SaveRow label="Save from number" disabled={from === v.twilioTest.from || !!fromErr} onSave={() => saveVoice({ twilioTest: { from } }, 'Twilio from number')} />}
          <SecretGroup
            provider="twilio_voice"
            title="Twilio voice credentials"
            help="Optional. Twilio Console → Account info: Account SID and Auth token."
            fields={[
              { key: 'accountSid', label: 'Account SID' },
              { key: 'authToken', label: 'Auth token' },
            ]}
            statuses={{ accountSid: v.twilioTest.accountSid, authToken: v.twilioTest.authToken }}
            stored={v.twilioTest.source === 'stored'}
            fallback={v.twilioTest.source === 'messaging' ? 'Using the Twilio account that sends SMS and WhatsApp.' : 'Not set: no Twilio account is available for test calls.'}
            disabled={disabled}
            onChanged={reload}
          />
        </Box>
      </div>
      <div className="max-w-xl">
        <ListEditor
          label="Test numbers"
          help="The only numbers the Twilio test line may call. E.164, e.g. +919876543210."
          values={nums}
          onChange={setNums}
          normalize={s => (isE164(s) ? s.replace(/[\s()-]/g, '') : null)}
          invalidText="Use E.164: + then country code and number."
          max={MAX_TEST_NUMBERS}
          placeholder="+919876543210"
          disabled={disabled}
        />
        {!disabled && (
          <div className="mt-2">
            <SaveRow label="Save test numbers" disabled={sameList(nums, v.testNumbers)} onSave={() => saveVoice({ testNumbers: nums }, 'Test numbers')} />
          </div>
        )}
      </div>
    </Part>
  )
}

function VoiceAi({ data, disabled, saveVoice, reload }: { data: Data; disabled: boolean; saveVoice: (patch: Patch, label: string) => Promise<boolean>; reload: () => Promise<void> }) {
  const v = data.voice
  const [stt, setStt] = useState(v.sarvam.sttModel)
  const [tts, setTts] = useState(v.sarvam.ttsModel)
  const [voices, setVoices] = useState(v.sarvam.voices)
  const [llm, setLlm] = useState(v.llmModel)
  useEffect(() => {
    setStt(v.sarvam.sttModel)
    setTts(v.sarvam.ttsModel)
    setVoices(v.sarvam.voices)
    setLlm(v.llmModel)
  }, [v])

  const voiceErr = (l: VoiceLang) => (valid({ sarvam: { voices: { [l]: voices[l] } } }) ? null : 'Lower-case speaker name.')
  const llmErr = llm.trim() && valid({ llmModel: llm }) ? null : 'A model ID, e.g. claude-haiku-5-5.'
  const dirty = stt !== v.sarvam.sttModel || tts !== v.sarvam.ttsModel || llm !== v.llmModel || VOICE_LANGS.some(l => voices[l] !== v.sarvam.voices[l])
  const bad = !!llmErr || VOICE_LANGS.some(l => voiceErr(l))
  const opts = (list: readonly string[], cur: string) => [...new Set([...list, cur])].map(m => ({ value: m, label: MODEL_LABEL[m] ?? m }))

  return (
    <Part title="Voice AI" status={ready(v.sarvam.configured && v.anthropic.configured)}>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Box title="Sarvam" status={ready(v.sarvam.configured)}>
          <SecretGroup
            provider="sarvam"
            title="Sarvam API key"
            help="Sarvam dashboard → API keys. Used for speech-to-text and text-to-speech."
            fields={[{ key: 'apiKey', label: 'API key' }]}
            statuses={{ apiKey: v.sarvam.apiKey }}
            stored={v.sarvam.apiKey.configured}
            disabled={disabled}
            onChanged={reload}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SelectField label="Speech-to-text model" help="Saaras v3 handles 22 Indian languages and code-mixing." value={stt} disabled={disabled} onChange={setStt} options={opts(SARVAM_STT_MODELS, stt)} />
            <SelectField label="Text-to-speech model" help="Bulbul v3. The voices below are Bulbul v3 speakers." value={tts} disabled={disabled} onChange={setTts} options={opts(SARVAM_TTS_MODELS, tts)} />
          </div>
        </Box>
        <Box title="Claude" status={ready(v.anthropic.configured)}>
          <Field label="Claude model ID" help={`Runs the call dialogue. Default ${DEFAULT_VOICE_LLM}.`} value={llm} error={llmErr} disabled={disabled} onChange={setLlm} />
          <SecretGroup
            provider="anthropic_voice"
            title="Anthropic API key"
            help="Optional. console.anthropic.com → API keys."
            fields={[{ key: 'apiKey', label: 'API key' }]}
            statuses={{ apiKey: v.anthropic.apiKey }}
            stored={v.anthropic.source === 'stored'}
            fallback={v.anthropic.source === 'env' ? 'Using the ANTHROPIC_API_KEY environment key.' : 'Not set: voice-service has no Claude key.'}
            disabled={disabled}
            onChanged={reload}
          />
        </Box>
      </div>
      <div>
        <span className="block text-xs text-foreground-muted mb-2">Voice per language</span>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {VOICE_LANGS.map(l => (
            <Field
              key={l}
              label={`${LANG_LABEL[l]} (${l})`}
              help={`Default ${DEFAULT_SARVAM_VOICES[l]}.`}
              value={voices[l]}
              placeholder={DEFAULT_SARVAM_VOICES[l]}
              error={voiceErr(l)}
              disabled={disabled}
              onChange={s => setVoices({ ...voices, [l]: s })}
            />
          ))}
        </div>
        <p className="text-xs text-foreground-muted mt-2">Speaker names from Sarvam&apos;s Bulbul voice list. An empty field uses the default.</p>
      </div>
      {!disabled && (
        <SaveRow
          label="Save voice AI settings"
          disabled={!dirty || bad}
          onSave={() => saveVoice({ sarvam: { sttModel: stt, ttsModel: tts, voices }, llmModel: llm.trim() }, 'Voice AI settings')}
        />
      )}
    </Part>
  )
}

function Dlt({
  data,
  disabled,
  saveSetting,
  clearSetting,
}: {
  data: Data
  disabled: boolean
  saveSetting: (key: string, value: unknown, label: string) => Promise<boolean>
  clearSetting: (key: string, label: string) => Promise<void>
}) {
  const d = data.dlt
  const [entity, setEntity] = useState(d.source.entityId === 'platform' ? (d.entityId ?? '') : '')
  const [senders, setSenders] = useState(d.source.senderIds === 'platform' ? d.senderIds : [])
  useEffect(() => {
    setEntity(d.source.entityId === 'platform' ? (d.entityId ?? '') : '')
    setSenders(d.source.senderIds === 'platform' ? d.senderIds : [])
  }, [d])
  const savedEntity = d.source.entityId === 'platform' ? (d.entityId ?? '') : ''
  const savedSenders = d.source.senderIds === 'platform' ? d.senderIds : []
  const entityErr = !entity.trim() || normalizeDltEntityId(entity) ? null : 'Digits only, as shown on the DLT portal.'

  return (
    <Part title="SMS India DLT" status={ready(!!d.entityId && d.senderIds.length > 0)}>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <Field
            label="DLT entity ID"
            help={d.source.entityId === 'env' ? 'Not set here: using AWS_SMS_DLT_ENTITY_ID.' : 'Principal Entity ID from the Airtel DLT portal (Entity → Profile).'}
            value={entity}
            error={entityErr}
            placeholder="1201159xxxxxxxxxxxx"
            disabled={disabled}
            onChange={setEntity}
          />
          {!disabled && (
            <div className="flex gap-2">
              <button
                type="button"
                className={btnPrimary}
                disabled={!entity.trim() || !!entityErr || entity.trim() === savedEntity}
                onClick={() => saveSetting('sms_dlt_entity_id', entity.trim(), 'DLT entity ID')}
              >
                Save entity ID
              </button>
              {savedEntity && (
                <button type="button" className={btnGhost} onClick={() => clearSetting('sms_dlt_entity_id', 'DLT entity ID')}>
                  Clear
                </button>
              )}
            </div>
          )}
        </div>
        <div className="space-y-2">
          <ListEditor
            label="Sender IDs"
            help={d.source.senderIds === 'env' ? 'Not set here: using AWS_SMS_DLT_SENDER_IDS.' : 'Approved headers from Airtel DLT → Headers: 6 letters or digits each.'}
            values={senders}
            onChange={setSenders}
            normalize={normalizeSenderId}
            invalidText="6 letters or digits, e.g. JEFFIS."
            max={MAX_SENDER_IDS}
            placeholder="JEFFIS"
            disabled={disabled}
          />
          {!disabled && (
            <div className="flex gap-2">
              <button type="button" className={btnPrimary} disabled={!senders.length || sameList(senders, savedSenders)} onClick={() => saveSetting('sms_dlt_sender_ids', senders, 'Sender IDs')}>
                Save sender IDs
              </button>
              {savedSenders.length > 0 && (
                <button type="button" className={btnGhost} onClick={() => clearSetting('sms_dlt_sender_ids', 'Sender IDs')}>
                  Clear
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      <p className="text-xs text-foreground-muted">Each SMS template&apos;s DLT template ID is set on that template.</p>
      <details className="rounded-lg border border-border-default p-3 text-xs text-foreground-muted">
        <summary className="cursor-pointer text-foreground">Airtel DLT portal steps</summary>
        <ol className="list-decimal pl-5 mt-2 space-y-1">
          <li>Register Jeffi as the Principal Entity and copy the Entity ID here.</li>
          <li>Add the sender headers and wait for approval, then list them above.</li>
          <li>Register each SMS template and put its template ID on the template.</li>
          <li>Under PE–TM chains, add Karix and Sinch, the telemarketers AWS End User Messaging delivers through.</li>
          <li>For calls, add Exotel&apos;s telemarketer ID {EXOTEL_TM_ID} to the chain.</li>
        </ol>
      </details>
    </Part>
  )
}

const bar = 'bg-surface-secondary rounded'

function OutreachSkeleton() {
  return (
    <div className="space-y-4 animate-pulse" aria-busy="true" aria-label="Loading Outreach providers">
      {[0, 1, 2].map(i => (
        <div key={i} className="space-y-2">
          <div className={`h-3 w-24 ${bar}`} />
          <div className={`h-24 w-full ${bar} opacity-70`} />
        </div>
      ))}
    </div>
  )
}
