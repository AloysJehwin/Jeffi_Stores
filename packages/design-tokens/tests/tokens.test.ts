// Tests for the compiled design-tokens package (index.js, no TS source).
import { describe, it, expect } from 'vitest'
import * as tokens from '@jeffi/design-tokens'
import { primary, secondary, accent, schemes, status, radius, fonts, cssVars } from '@jeffi/design-tokens'

const SCALE_KEYS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]
const isHex = (v: string) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)

describe('exports', () => {
  it('exposes every documented export', () => {
    // CommonJS interop adds a `default` namespace key; the named exports are what matters.
    expect(Object.keys(tokens).filter((k) => k !== 'default').sort()).toEqual(
      ['accent', 'cssVars', 'fonts', 'primary', 'radius', 'schemes', 'secondary', 'status'].sort(),
    )
    expect(typeof cssVars).toBe('function')
  })
})

describe('color scales', () => {
  for (const [name, scale] of [['primary', primary], ['secondary', secondary], ['accent', accent]] as const) {
    it(`${name} is a full 10-step hex scale`, () => {
      expect(Object.keys(scale).map(Number).sort((a, b) => a - b)).toEqual(SCALE_KEYS)
      for (const k of SCALE_KEYS) expect(isHex(scale[k as keyof typeof scale])).toBe(true)
    })
  }

  it('has exact anchor values', () => {
    expect(primary[50]).toBe('#fffbeb')
    expect(primary[500]).toBe('#f59e0b')
    expect(primary[900]).toBe('#78350f')
    expect(secondary[500]).toBe('#363948')
    expect(accent[500]).toBe('#7cb900')
    expect(accent[900]).toBe('#2b4200')
  })
})

describe('schemes', () => {
  it('has light and dark only', () => {
    expect(Object.keys(schemes).sort()).toEqual(['dark', 'light'])
  })

  const fields = [
    'surface', 'surfaceElevated', 'surfaceSecondary',
    'foreground', 'foregroundSecondary', 'foregroundMuted',
    'border', 'borderSecondary',
    'primary500', 'primary600', 'accent500', 'accent600', 'cardShadow',
  ] as const

  for (const scheme of ['light', 'dark'] as const) {
    it(`${scheme} has every field as a string`, () => {
      for (const f of fields) expect(typeof schemes[scheme][f]).toBe('string')
    })
  }

  it('has exact light values', () => {
    expect(schemes.light.surface).toBe('#f9fafb')
    expect(schemes.light.foreground).toBe('#111827')
    expect(schemes.light.primary500).toBe('#f59e0b')
    expect(schemes.light.accent500).toBe('#7cb900')
  })

  it('has exact dark values that differ from light', () => {
    expect(schemes.dark.surface).toBe('#1a1b23')
    expect(schemes.dark.foreground).toBe('#f3f4f6')
    expect(schemes.dark.primary500).toBe('#d97706')
    expect(schemes.dark.accent500).toBe('#74a800')
    expect(schemes.dark.surface).not.toBe(schemes.light.surface)
    // cardShadow is shared across schemes
    expect(schemes.dark.cardShadow).toBe(schemes.light.cardShadow)
  })
})

describe('status / radius / fonts', () => {
  it('status colors', () => {
    expect(status).toEqual({
      success: '#16a34a', danger: '#dc2626', heart: '#ef4444', digital: '#7c3aed',
      saleFrom: '#f43f5e', saleTo: '#f97316', white: '#ffffff', black: '#000000',
    })
  })

  it('radius is numeric', () => {
    expect(radius).toEqual({ card: 12, button: 8, pill: 999, hero: 20 })
    for (const v of Object.values(radius)) expect(typeof v).toBe('number')
  })

  it('fonts', () => {
    expect(fonts).toEqual({ display: 'Bebas Neue', body: 'Inter' })
  })
})

describe('cssVars()', () => {
  it('maps light scheme to CSS custom properties', () => {
    const vars = cssVars('light')
    expect(vars['--color-surface']).toBe(schemes.light.surface)
    expect(vars['--color-surface-elevated']).toBe(schemes.light.surfaceElevated)
    expect(vars['--color-surface-secondary']).toBe(schemes.light.surfaceSecondary)
    expect(vars['--color-foreground']).toBe(schemes.light.foreground)
    expect(vars['--color-foreground-secondary']).toBe(schemes.light.foregroundSecondary)
    expect(vars['--color-foreground-muted']).toBe(schemes.light.foregroundMuted)
    expect(vars['--color-border']).toBe(schemes.light.border)
    expect(vars['--color-border-secondary']).toBe(schemes.light.borderSecondary)
    expect(vars['--color-card-shadow']).toBe(schemes.light.cardShadow)
    expect(vars['--primary-500']).toBe(schemes.light.primary500)
    expect(vars['--primary-600']).toBe(schemes.light.primary600)
    expect(vars['--accent-500']).toBe(schemes.light.accent500)
    expect(vars['--accent-600']).toBe(schemes.light.accent600)
  })

  it('maps dark scheme and differs from light', () => {
    const vars = cssVars('dark')
    expect(vars['--color-surface']).toBe(schemes.dark.surface)
    expect(vars['--primary-500']).toBe(schemes.dark.primary500)
    expect(vars['--accent-500']).toBe(schemes.dark.accent500)
    expect(cssVars('dark')['--color-surface']).not.toBe(cssVars('light')['--color-surface'])
  })

  it('returns the same 13 keys for both schemes', () => {
    const light = Object.keys(cssVars('light')).sort()
    const dark = Object.keys(cssVars('dark')).sort()
    expect(light).toEqual(dark)
    expect(light).toHaveLength(13)
  })
})
