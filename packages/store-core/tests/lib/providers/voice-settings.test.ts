import { describe, it, expect } from 'vitest'
import {
  DEFAULT_AZURE_VOICES,
  DEFAULT_VOICE_SETTINGS,
  VOICE_LANGS,
  mergeVoiceSettings,
  normalizeVoiceConfig,
} from '@/lib/providers/voice-settings'

describe('voice settings: speech engines and Azure Speech', () => {
  it('has an Azure neural voice for every call language', () => {
    expect(Object.keys(DEFAULT_AZURE_VOICES).sort()).toEqual([...VOICE_LANGS].sort())
    for (const l of VOICE_LANGS) expect(DEFAULT_AZURE_VOICES[l]).toMatch(new RegExp(`^${l}-IN-\\w+Neural$`))
  })

  it('defaults to Sarvam for STT and TTS, in Central India', () => {
    const m = mergeVoiceSettings(undefined)
    expect(m.speech).toEqual({ sttProvider: 'sarvam', ttsProvider: 'sarvam' })
    expect(m.azureSpeech).toEqual(DEFAULT_VOICE_SETTINGS.azureSpeech)
    expect(m.azureSpeech.region).toBe('centralindia')
  })

  it('normalizes the engine per direction, the region and the voices', () => {
    expect(
      normalizeVoiceConfig({
        speech: { sttProvider: 'azure', ttsProvider: 'sarvam' },
        azureSpeech: { region: ' SouthIndia ', voices: { hi: 'hi-IN-MadhurNeural', ta: '' } },
      })
    ).toEqual({
      speech: { sttProvider: 'azure', ttsProvider: 'sarvam' },
      azureSpeech: { region: 'southindia', voices: { hi: 'hi-IN-MadhurNeural' } },
    })
    expect(normalizeVoiceConfig({ speech: { ttsProvider: 'azure' } })).toEqual({ speech: { ttsProvider: 'azure' } })
    expect(normalizeVoiceConfig({ speech: {}, azureSpeech: {} })).toEqual({})
  })

  it('rejects an unknown engine, region, voice name, language or shape', () => {
    expect(normalizeVoiceConfig({ speech: { sttProvider: 'google' } })).toBeNull()
    expect(normalizeVoiceConfig({ speech: 'azure' })).toBeNull()
    expect(normalizeVoiceConfig({ azureSpeech: { region: 'mars' } })).toBeNull()
    expect(normalizeVoiceConfig({ azureSpeech: { region: 'a.evil.example/' } })).toBeNull()
    expect(normalizeVoiceConfig({ azureSpeech: { voices: { hi: 'priya' } } })).toBeNull()
    expect(normalizeVoiceConfig({ azureSpeech: { voices: { hi: "hi-IN-X'><Neural" } } })).toBeNull()
    expect(normalizeVoiceConfig({ azureSpeech: { voices: ['hi-IN-SwaraNeural'] } })).toBeNull()
    expect(normalizeVoiceConfig({ azureSpeech: 'x' })).toBeNull()
  })

  it('merges stored voices over the defaults per language', () => {
    const m = mergeVoiceSettings({ azureSpeech: { voices: { hi: 'hi-IN-MadhurNeural' } }, speech: { sttProvider: 'azure' } })
    expect(m.azureSpeech.voices).toEqual({ ...DEFAULT_AZURE_VOICES, hi: 'hi-IN-MadhurNeural' })
    expect(m.speech).toEqual({ sttProvider: 'azure', ttsProvider: 'sarvam' })
  })

  it('treats an invalid stored value as unset', () => {
    expect(mergeVoiceSettings({ speech: { sttProvider: 'bogus' } }).speech).toEqual(DEFAULT_VOICE_SETTINGS.speech)
  })
})
