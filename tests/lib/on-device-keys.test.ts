import { describe, it, expect } from 'vitest'
import { onDeviceKeys, normalizeSlug } from '@/lib/on-device/keys'

// #489: the on-device LoRA adapter is per-store. Its IndexedDB key must be namespaced by tenant so
// one store's fine-tune never loads into another's inference on a shared browser.

describe('normalizeSlug', () => {
  it('defaults empty/absent to platform', () => {
    expect(normalizeSlug(null)).toBe('platform')
    expect(normalizeSlug(undefined)).toBe('platform')
    expect(normalizeSlug('')).toBe('platform')
    expect(normalizeSlug('   ')).toBe('platform')
  })

  it('lowercases and strips unsafe characters', () => {
    expect(normalizeSlug('Acme Corp')).toBe('acmecorp')
    expect(normalizeSlug('acme-store')).toBe('acme-store')
    expect(normalizeSlug('../evil')).toBe('evil')
  })
})

describe('onDeviceKeys', () => {
  it('produces a distinct LoRA key per tenant slug', () => {
    expect(onDeviceKeys('acme').loraKey).not.toBe(onDeviceKeys('globex').loraKey)
  })

  it('platform (no slug) is stable and distinct from any tenant', () => {
    const platform = onDeviceKeys(null).loraKey
    expect(platform).toBe(onDeviceKeys(undefined).loraKey)
    expect(platform).not.toBe(onDeviceKeys('acme').loraKey)
    expect(platform).toContain('platform')
  })

  it('the same slug always maps to the same key', () => {
    expect(onDeviceKeys('acme').loraKey).toBe(onDeviceKeys('acme').loraKey)
  })
})
