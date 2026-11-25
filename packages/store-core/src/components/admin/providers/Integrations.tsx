'use client'

import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'
import Select from '@/components/ui/Select'
import { Badge, btnGhost, inputCls } from '@/components/admin/kit/core'
import {
  AZURE_SPEECH_REGIONS,
  DEFAULT_AZURE_VOICES,
  DEFAULT_SARVAM_VOICES,
  DEFAULT_VOICE_LLM,
  EXOTEL_SUBDOMAINS,
  MAX_SENDER_IDS,
  MAX_TEST_NUMBERS,
  SARVAM_STT_MODELS,
  SARVAM_TTS_MODELS,
  VOICE_LANGS,
  type ExotelSubdomain,
  type SpeechEngine,
  type StoredVoiceConfig,
  type VoiceLang,
  isE164,
  normalizeDltEntityId,
  normalizeSenderId,
  normalizeVoiceConfig,
} from '@/lib/providers/voice-settings'
import { asList, asText, clearSettings, keyStatus, putSettings, same, type ProvidersData, type VoiceView } from './model'
import { Panel, SaveButton, StatusLine, TestButton, TextField, useSectionSave } from './parts'

// Flagship administrator, platform scope: Outreach calling, the test line, the call's voice AI and India SMS DLT.
// Configuration only: every key comes from the platform's secrets (jeffi/production), shown by name and presence.

const LANG_LABEL: Record<VoiceLang, string> = { en: 'English', hi: 'Hindi', ta: 'Tamil', te: 'Telugu', kn: 'Kannada', ml: 'Malayalam', mr: 'Marathi', bn: 'Bengali', gu: 'Gujarati' }
const REGION_LABEL: Record<string, string> = { 'api.in.exotel.com': 'Mumbai', 'api.exotel.com': 'Singapore' }
const AZURE_REGION_LABEL: Record<string, string> = {
  centralindia: 'Central India',
  southindia: 'South India',
  westindia: 'West India',
  southeastasia: 'Southeast Asia',
  eastasia: 'East Asia',
  uaenorth: 'UAE North',
}
const MODEL_LABEL: Record<string, string> = { 'saaras:v3': 'Saaras v3', 'saaras:v4': 'Saaras v4', 'bulbul:v3': 'Bulbul v3', 'bulbul:v2': 'Bulbul v2' }
const ENGINE_LABEL: Record<SpeechEngine, string> = { sarvam: 'Sarvam', azure: 'Azure AI Speech' }

const valid = (cfg: StoredVoiceConfig) => normalizeVoiceConfig(cfg) !== null
const opts = (list: readonly string[], cur: string, label: Record<string, string> = {}, hint = false) =>
  [...new Set([...list, cur].filter(Boolean))].map(m => ({ value: m, label: label[m] ?? m, hint: hint && label[m] ? m : undefined }))

/** The stored, non-secret voice config; each card's save merges its part over it. */
function storedOf(v: VoiceView): StoredVoiceConfig {
  return {
    exotel: { accountSid: v.exotel.accountSid, subdomain: v.exotel.subdomain as ExotelSubdomain, callerId: v.exotel.callerId, appId: v.exotel.appId },
    twilioTest: { from: v.twilioTest.from },
    testNumbers: v.testNumbers,
    sarvam: { sttModel: v.sarvam.sttModel, ttsModel: v.sarvam.ttsModel, voices: v.sarvam.voices },
    speech: v.speech,
    azureSpeech: { region: v.azureSpeech.region, voices: v.azureSpeech.voices },
    llmModel: v.llmModel,
  }
}

export default function Integrations({ data, canWrite, onSaved }: { data: ProvidersData; canWrite: boolean; onSaved: () => Promise<void> }) {
  const editable = canWrite && data.canEdit.integrations
  const v = data.voice
  const saveVoice = (patch: StoredVoiceConfig) => putSettings(null, [['voice_config', { ...(v ? storedOf(v) : {}), ...patch }]])
  return (
    <Panel id="providers-integrations" title="Integrations" description="Calling, the call's voice AI and India SMS DLT. Configuration only: the keys are read from the platform's secrets.">
      {!v ? (
        <p className="text-sm text-foreground-muted">The voice configuration did not load.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Exotel v={v} data={data} editable={editable} save={saveVoice} onSaved={onSaved} />
          <TwilioTest v={v} data={data} editable={editable} save={saveVoice} onSaved={onSaved} />
          <div className="lg:col-span-2">
            <CallVoice v={v} data={data} editable={editable} save={saveVoice} onSaved={onSaved} />
          </div>
        </div>
      )}
      <div className="mt-4">
        <Dlt data={data} editable={editable} onSaved={onSaved} />
      </div>
    </Panel>
  )
}

function Box({ title, ready, keys, children, footer }: { title: string; ready?: boolean; keys?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col rounded-lg border border-border-default bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-default px-4 py-3">
        <span className="text-sm font-medium text-foreground">{title}</span>
        {ready !== undefined && <Badge tone={ready ? 'green' : 'amber'}>{ready ? 'Ready' : 'Incomplete'}</Badge>}
      </div>
      {keys && <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-border-default px-4 py-2">{keys}</div>}
      <div className="flex-1 space-y-3 p-4">{children}</div>
      {footer && <div className="flex flex-wrap items-start justify-between gap-3 border-t border-border-default px-4 py-3">{footer}</div>}
    </div>
  )
}

function Keys({ data, provider, label }: { data: ProvidersData; provider: string; label: string }) {
  const s = keyStatus(data.secrets, provider)
  return s ? (
    <span className="inline-flex items-center gap-1.5 text-xs text-foreground-muted">
      {label}
      <StatusLine ok={s.ok} mono={s.secret}>
        {s.text}
      </StatusLine>
    </span>
  ) : null
}

type CardProps = { v: VoiceView; data: ProvidersData; editable: boolean; save: (patch: StoredVoiceConfig) => ReturnType<typeof putSettings>; onSaved: () => Promise<void> }
const exotelOf = (e: VoiceView['exotel']) => ({ accountSid: e.accountSid, subdomain: e.subdomain, callerId: e.callerId, appId: e.appId })

function Exotel({ v, data, editable, save, onSaved }: CardProps) {
  const [ex, setEx] = useState(exotelOf(v.exotel))
  useEffect(() => setEx(exotelOf(v.exotel)), [v.exotel])
  const { state, run, touch } = useSectionSave('Exotel calling')
  const set = (patch: Partial<typeof ex>) => {
    touch()
    setEx(e => ({ ...e, ...patch }))
  }
  const err = {
    accountSid: valid({ exotel: { accountSid: ex.accountSid } }) ? null : 'Letters, digits, - and _ only.',
    callerId: valid({ exotel: { callerId: ex.callerId } }) ? null : 'A phone number, e.g. +911401234567.',
    appId: valid({ exotel: { appId: ex.appId } }) ? null : 'Letters, digits, - and _ only.',
  }
  const dirty = !same(ex, exotelOf(v.exotel))
  return (
    <Box
      title="Exotel calling"
      ready={v.exotel.configured}
      keys={<Keys data={data} provider="exotel" label="API key and token" />}
      footer={
        editable && (
          <>
            <TestButton provider="exotel" hint="Reads the account balance with the keys in the secrets. No call is placed." />
            <SaveButton label="Save Exotel" dirty={dirty} invalid={Object.values(err).some(Boolean)} state={state} onSave={() => run(() => save({ exotel: { ...ex, subdomain: ex.subdomain as ExotelSubdomain } }), onSaved)} />
          </>
        )
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextField label="Account SID" help="Exotel → Settings → API settings." value={ex.accountSid} error={err.accountSid} disabled={!editable} mono onChange={s => set({ accountSid: s })} />
        <div>
          <span className="mb-1 block text-xs text-foreground-muted">Region</span>
          <Select className="w-full" size="sm" aria-label="Region" value={ex.subdomain} disabled={!editable} onChange={s => set({ subdomain: s })} options={opts(EXOTEL_SUBDOMAINS, ex.subdomain, REGION_LABEL, true)} />
        </div>
        <TextField label="Caller number" help="Your 140-series ExoPhone." value={ex.callerId} error={err.callerId} placeholder="+911401234567" disabled={!editable} mono onChange={s => set({ callerId: s })} />
        <TextField label="AgentStream app ID" help="The App Bazaar flow with the AgentStream applet." value={ex.appId} error={err.appId} disabled={!editable} mono onChange={s => set({ appId: s })} />
      </div>
    </Box>
  )
}

function TwilioTest({ v, data, editable, save, onSaved }: CardProps) {
  const [from, setFrom] = useState(v.twilioTest.from)
  const [nums, setNums] = useState(v.testNumbers)
  useEffect(() => {
    setFrom(v.twilioTest.from)
    setNums(v.testNumbers)
  }, [v.twilioTest.from, v.testNumbers])
  const { state, run, touch } = useSectionSave('Twilio test line')
  const fromErr = !from.trim() || isE164(from) ? null : 'E.164, e.g. +14155550100.'
  const dirty = from !== v.twilioTest.from || !same(nums, v.testNumbers)
  return (
    <Box
      title="Twilio test line"
      ready={v.twilioTest.configured}
      keys={<Keys data={data} provider="twilio_test" label="Account SID and token" />}
      footer={
        editable && (
          <>
            <TestButton provider="twilio_voice" hint="Checks the Twilio account in the secrets. No call is placed." />
            <SaveButton label="Save test line" dirty={dirty} invalid={!!fromErr} state={state} onSave={() => run(() => save({ twilioTest: { from: from.trim() }, testNumbers: nums }), onSaved)} />
          </>
        )
      }
    >
      <TextField
        label="From number"
        help="A voice-capable Twilio number. It only ever calls the test numbers."
        value={from}
        error={fromErr}
        placeholder="+14155550100"
        disabled={!editable}
        mono
        onChange={s => {
          touch()
          setFrom(s)
        }}
      />
      <ListEditor
        label="Test numbers"
        help="The only numbers the test line may call."
        values={nums}
        onChange={n => {
          touch()
          setNums(n)
        }}
        normalize={s => (isE164(s) ? s.replace(/[\s()-]/g, '') : null)}
        invalidText="Use E.164: + then country code and number."
        max={MAX_TEST_NUMBERS}
        placeholder="+919876543210"
        disabled={!editable}
      />
    </Box>
  )
}

const voiceOf = (v: VoiceView) => ({
  speech: v.speech,
  sttModel: v.sarvam.sttModel,
  ttsModel: v.sarvam.ttsModel,
  region: v.azureSpeech.region,
  llm: v.llmModel,
  sarvamVoices: v.sarvam.voices,
  azureVoices: v.azureSpeech.voices,
})

function CallVoice({ v, data, editable, save, onSaved }: CardProps) {
  const [f, setF] = useState(voiceOf(v))
  useEffect(() => setF(voiceOf(v)), [v])
  const { state, run, touch } = useSectionSave('Call voice')
  const set = (patch: Partial<typeof f>) => {
    touch()
    setF(x => ({ ...x, ...patch }))
  }
  const llmErr = f.llm.trim() && valid({ llmModel: f.llm.trim() }) ? null : 'A model ID, e.g. claude-haiku-5-5.'
  const sarvamErr = (l: VoiceLang) => (valid({ sarvam: { voices: { [l]: f.sarvamVoices[l] } } }) ? null : 'Lower-case speaker name.')
  const azureErr = (l: VoiceLang) => (valid({ azureSpeech: { voices: { [l]: f.azureVoices[l] } } }) ? null : 'A voice like hi-IN-SwaraNeural.')
  const invalid = !!llmErr || VOICE_LANGS.some(l => sarvamErr(l) || azureErr(l))
  const dirty = !same(f, voiceOf(v))
  const other = (e: SpeechEngine): SpeechEngine => (e === 'sarvam' ? 'azure' : 'sarvam')
  const ready = (v.sarvam.configured || v.azureSpeech.configured) && v.anthropic.configured

  return (
    <Box
      title="Call voice"
      ready={ready}
      keys={
        <>
          <Keys data={data} provider="sarvam" label="Sarvam" />
          <Keys data={data} provider="azure_speech" label="Azure Speech" />
          {v.anthropic.federation ? <span className="text-xs text-foreground-muted">Claude via workload identity</span> : <Keys data={data} provider="anthropic" label="Claude" />}
        </>
      }
      footer={
        editable && (
          <>
            <div className="flex flex-wrap gap-3">
              <TestButton provider="sarvam" label="Test Sarvam" hint="Checks the Sarvam key in the secrets. Nothing is spoken or transcribed." />
              <TestButton provider="azure_speech" label="Test Azure Speech" hint="Asks the region for a short-lived token with the key in the secrets." />
            </div>
            <SaveButton
              label="Save call voice"
              dirty={dirty}
              invalid={invalid}
              state={state}
              onSave={() =>
                run(
                  () =>
                    save({
                      speech: f.speech,
                      sarvam: { sttModel: f.sttModel, ttsModel: f.ttsModel, voices: f.sarvamVoices },
                      azureSpeech: { region: f.region, voices: f.azureVoices },
                      llmModel: f.llm.trim(),
                    }),
                  onSaved
                )
              }
            />
          </>
        )
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <div>
          <span className="mb-1 block text-xs text-foreground-muted">Speech-to-text engine order</span>
          <Select
            className="w-full"
            size="sm"
            aria-label="Speech-to-text engine order"
            value={f.speech.sttProvider}
            disabled={!editable}
            onChange={e => set({ speech: { ...f.speech, sttProvider: e } })}
            options={(['sarvam', 'azure'] as const).map(e => ({ value: e, label: `${ENGINE_LABEL[e]}, then ${ENGINE_LABEL[other(e)]}` }))}
          />
          <span className="mt-1 block text-xs text-foreground-muted">The second takes over when the first can&apos;t start.</span>
        </div>
        <div>
          <span className="mb-1 block text-xs text-foreground-muted">Text-to-speech engine</span>
          <Select
            className="w-full"
            size="sm"
            aria-label="Text-to-speech engine"
            value={f.speech.ttsProvider}
            disabled={!editable}
            onChange={e => set({ speech: { ...f.speech, ttsProvider: e } })}
            options={(['sarvam', 'azure'] as const).map(e => ({ value: e, label: ENGINE_LABEL[e] }))}
          />
        </div>
        <TextField label="Claude model for calls" help={`Runs the call dialogue. Default ${DEFAULT_VOICE_LLM}.`} value={f.llm} error={llmErr} disabled={!editable} mono onChange={s => set({ llm: s })} />
        <div>
          <span className="mb-1 block text-xs text-foreground-muted">Sarvam speech-to-text model</span>
          <Select className="w-full" size="sm" aria-label="Sarvam speech-to-text model" value={f.sttModel} disabled={!editable} onChange={s => set({ sttModel: s })} options={opts(SARVAM_STT_MODELS, f.sttModel, MODEL_LABEL)} />
        </div>
        <div>
          <span className="mb-1 block text-xs text-foreground-muted">Sarvam text-to-speech model</span>
          <Select className="w-full" size="sm" aria-label="Sarvam text-to-speech model" value={f.ttsModel} disabled={!editable} onChange={s => set({ ttsModel: s })} options={opts(SARVAM_TTS_MODELS, f.ttsModel, MODEL_LABEL)} />
        </div>
        <div>
          <span className="mb-1 block text-xs text-foreground-muted">Azure Speech region</span>
          <Select className="w-full" size="sm" aria-label="Azure Speech region" value={f.region} disabled={!editable} onChange={s => set({ region: s })} options={opts(AZURE_SPEECH_REGIONS, f.region, AZURE_REGION_LABEL)} />
        </div>
      </div>
      <details className="group rounded-lg border border-border-default">
        <summary className="flex cursor-pointer items-center justify-between px-3 py-2 text-sm text-foreground">
          Voice per language
          <span className="text-xs text-foreground-muted">Sarvam and Azure speakers</span>
        </summary>
        <div className="overflow-x-auto border-t border-border-default">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-foreground-muted">
                <th className="px-3 py-2 font-medium">Language</th>
                <th className="px-3 py-2 font-medium">Sarvam voice</th>
                <th className="px-3 py-2 font-medium">Azure voice</th>
              </tr>
            </thead>
            <tbody>
              {VOICE_LANGS.map(l => (
                <tr key={l} className="border-t border-border-default align-top">
                  <td className="whitespace-nowrap px-3 py-2 text-foreground">
                    {LANG_LABEL[l]} <span className="font-mono text-xs text-foreground-muted">{l}</span>
                  </td>
                  <td className="px-3 py-2">
                    <VoiceInput label={`Sarvam ${LANG_LABEL[l]} voice`} value={f.sarvamVoices[l]} placeholder={DEFAULT_SARVAM_VOICES[l]} error={sarvamErr(l)} disabled={!editable} onChange={s => set({ sarvamVoices: { ...f.sarvamVoices, [l]: s } })} />
                  </td>
                  <td className="px-3 py-2">
                    <VoiceInput label={`Azure ${LANG_LABEL[l]} voice`} value={f.azureVoices[l]} placeholder={DEFAULT_AZURE_VOICES[l]} error={azureErr(l)} disabled={!editable} onChange={s => set({ azureVoices: { ...f.azureVoices, [l]: s } })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-3 pb-3 pt-1 text-xs text-foreground-muted">An empty field uses the default shown.</p>
        </div>
      </details>
    </Box>
  )
}

function VoiceInput({ label, value, placeholder, error, disabled, onChange }: { label: string; value: string; placeholder: string; error: string | null; disabled: boolean; onChange: (v: string) => void }) {
  return (
    <>
      <input className={`${inputCls} min-w-[11rem] py-1.5 font-mono text-xs`} aria-label={label} aria-invalid={!!error} value={value} placeholder={placeholder} disabled={disabled} spellCheck={false} autoComplete="off" onChange={e => onChange(e.target.value)} />
      {error && <span className="mt-1 block text-xs text-red-600 dark:text-red-400">{error}</span>}
    </>
  )
}

function Dlt({ data, editable, onSaved }: { data: ProvidersData; editable: boolean; onSaved: () => Promise<void> }) {
  const savedEntity = useMemo(() => (data.dlt ? (data.dlt.source?.entityId === 'env' ? '' : (data.dlt.entityId ?? '')) : asText(data.settings.sms_dlt_entity_id)), [data])
  const savedSenders = useMemo(() => (data.dlt ? (data.dlt.source?.senderIds === 'env' ? [] : data.dlt.senderIds) : asList(data.settings.sms_dlt_sender_ids)), [data])
  const [entity, setEntity] = useState(savedEntity)
  const [senders, setSenders] = useState(savedSenders)
  useEffect(() => {
    setEntity(savedEntity)
    setSenders(savedSenders)
  }, [savedEntity, savedSenders])
  const { state, run, touch } = useSectionSave('SMS India DLT')
  const entityErr = !entity.trim() || normalizeDltEntityId(entity) ? null : 'Digits only, as shown on the DLT portal.'
  const dirty = entity.trim() !== savedEntity || !same(senders, savedSenders)

  const save = () =>
    run(async () => {
      const put: [string, unknown][] = []
      const clear: string[] = []
      if (entity.trim() !== savedEntity) (entity.trim() ? put.push(['sms_dlt_entity_id', entity.trim()]) : clear.push('sms_dlt_entity_id'))
      if (!same(senders, savedSenders)) (senders.length ? put.push(['sms_dlt_sender_ids', senders]) : clear.push('sms_dlt_sender_ids'))
      const r = await putSettings(null, put)
      return r.ok ? clearSettings(null, clear) : r
    }, onSaved)

  return (
    <Box
      title="SMS India DLT"
      ready={!!(data.dlt ? data.dlt.entityId : savedEntity) && (data.dlt ? data.dlt.senderIds : savedSenders).length > 0}
      footer={editable && <SaveButton label="Save DLT" dirty={dirty} invalid={!!entityErr} state={state} onSave={save} />}
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TextField
          label="DLT entity ID"
          help={data.dlt?.source?.entityId === 'env' ? 'Not set here: using AWS_SMS_DLT_ENTITY_ID.' : 'Principal Entity ID from the Airtel DLT portal.'}
          value={entity}
          error={entityErr}
          placeholder="1201159xxxxxxxxxxxx"
          disabled={!editable}
          mono
          onChange={s => {
            touch()
            setEntity(s)
          }}
        />
        <ListEditor
          label="Sender IDs"
          help={data.dlt?.source?.senderIds === 'env' ? 'Not set here: using AWS_SMS_DLT_SENDER_IDS.' : 'Approved 6-character headers.'}
          values={senders}
          onChange={s => {
            touch()
            setSenders(s)
          }}
          normalize={normalizeSenderId}
          invalidText="6 letters or digits, e.g. JEFFIS."
          max={MAX_SENDER_IDS}
          placeholder="JEFFIS"
          disabled={!editable}
        />
      </div>
    </Box>
  )
}

/** A short list of values with add / remove and per-entry validation. */
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
    const n = normalize(input)
    if (!n) return setError(invalidText)
    if (full) return setError(`At most ${max}.`)
    setError(null)
    setInput('')
    if (!values.includes(n)) onChange([...values, n])
  }
  return (
    <div className="min-w-0">
      <span className="mb-1 block text-xs text-foreground-muted">{label}</span>
      {values.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5" aria-label={label}>
          {values.map(x => (
            <li key={x} className="inline-flex items-center gap-1 rounded-md bg-surface-secondary py-0.5 pl-2 pr-1 font-mono text-xs text-foreground">
              {x}
              {!disabled && (
                <button type="button" className="rounded p-0.5 text-foreground-muted hover:text-foreground" onClick={() => onChange(values.filter(y => y !== x))} aria-label={`Remove ${x}`}>
                  <X className="h-3 w-3" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!disabled && (
        <div className="flex gap-2">
          <input
            className={`${inputCls} font-mono`}
            aria-label={`Add to ${label}`}
            value={input}
            placeholder={placeholder}
            disabled={full}
            spellCheck={false}
            autoComplete="off"
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                add()
              }
            }}
          />
          <button type="button" className={btnGhost} disabled={!input.trim() || full} onClick={add} aria-label={`Add ${label.toLowerCase().replace(/s$/, '')}`}>
            <Plus className="h-3.5 w-3.5" />
            Add
          </button>
        </div>
      )}
      {error ? (
        <span className="mt-1 block text-xs text-red-600 dark:text-red-400">{error}</span>
      ) : (
        <span className="mt-1 block text-xs text-foreground-muted">
          {help} {values.length}/{max}.
        </span>
      )}
    </div>
  )
}
