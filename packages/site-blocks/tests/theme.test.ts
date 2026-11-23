import { describe, it, expect } from 'vitest'
import {
  DEFAULT_THEME,
  STYLE_CHOICES,
  FONT_CHOICES,
  SHADES,
  normalizeTheme,
  paletteFrom,
  themeCssVars,
  styleCssVars,
  googleFontsHref,
  cssVarsRule,
  type ThemeTokens,
} from '@jeffi/site-blocks'

describe('normalizeTheme', () => {
  it('returns the defaults for null/undefined/empty', () => {
    expect(normalizeTheme(null)).toEqual(DEFAULT_THEME)
    expect(normalizeTheme(undefined)).toEqual(DEFAULT_THEME)
    expect(normalizeTheme({})).toEqual(DEFAULT_THEME)
  })

  it('keeps valid hex colours and lowercases them', () => {
    const t = normalizeTheme({ primary: '#ABCDEF', accent: '#123456', neutral: '#0a0B0c' })
    expect(t.primary).toBe('#abcdef')
    expect(t.accent).toBe('#123456')
    expect(t.neutral).toBe('#0a0b0c')
  })

  it('falls back on bad hex (wrong length, non-hex, non-string)', () => {
    const t = normalizeTheme({ primary: '#fff', accent: 'red', neutral: 123 as any })
    expect(t.primary).toBe(DEFAULT_THEME.primary)
    expect(t.accent).toBe(DEFAULT_THEME.accent)
    expect(t.neutral).toBe(DEFAULT_THEME.neutral)
  })

  it('keeps fonts only from the fixed list', () => {
    const t = normalizeTheme({ fontDisplay: 'Oswald', fontBody: 'NotAFont' })
    expect(t.fontDisplay).toBe('Oswald')
    expect(t.fontBody).toBe(DEFAULT_THEME.fontBody)
  })

  it('validates enum tokens, falling back on unknown values', () => {
    expect(normalizeTheme({ radius: 'full' }).radius).toBe('full')
    expect(normalizeTheme({ radius: 'nope' as any }).radius).toBe(DEFAULT_THEME.radius)
    expect(normalizeTheme({ buttonStyle: 'outline' }).buttonStyle).toBe('outline')
    expect(normalizeTheme({ buttonStyle: 'bad' as any }).buttonStyle).toBe(DEFAULT_THEME.buttonStyle)
    expect(normalizeTheme({ density: 'airy' }).density).toBe('airy')
    expect(normalizeTheme({ density: 'bad' as any }).density).toBe(DEFAULT_THEME.density)
  })

  it('keeps valid optional style tokens and drops invalid ones entirely', () => {
    const t = normalizeTheme({ buttonShape: 'pill', cardStyle: 'bad' as any, shadow: 'strong' })
    expect(t.buttonShape).toBe('pill')
    expect(t.shadow).toBe('strong')
    expect('cardStyle' in t).toBe(false)
  })

  it('leaves all style tokens absent when none are supplied', () => {
    const t = normalizeTheme({ primary: '#abcdef' })
    for (const k of Object.keys(STYLE_CHOICES)) expect(k in t).toBe(false)
  })
})

describe('paletteFrom', () => {
  it('returns all ten shades with 500 equal to the input colour', () => {
    const p = paletteFrom('#f59e0b')
    expect(Object.keys(p).map(Number)).toEqual([...SHADES])
    expect(p[500]).toBe('#f59e0b')
  })
  it('lightens toward white below 500 and darkens toward black above', () => {
    const p = paletteFrom('#808080')
    // 50 is a light tint, 900 is near-black.
    expect(p[50] > p[500]).toBe(true) // lexicographic on grey works: lighter hex is larger
    expect(p[900] < p[500]).toBe(true)
  })
  it('clamps channels and pads each to two hex digits', () => {
    const p = paletteFrom('#000000')
    expect(p[900]).toBe('#000000')
    for (const s of SHADES) expect(p[s]).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('themeCssVars', () => {
  const vars = themeCssVars(DEFAULT_THEME)

  it('emits a 50-900 channel scale for primary, accent and secondary', () => {
    for (const name of ['primary', 'accent', 'secondary']) {
      for (const s of SHADES) {
        expect(vars[`--c-${name}-${s}`]).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/)
      }
    }
  })

  it('sets legacy brand vars and ink only for primary and accent, not secondary', () => {
    expect(vars['--primary-500']).toBeDefined()
    expect(vars['--accent-500']).toBeDefined()
    expect(vars['--on-primary-500']).toMatch(/^#(ffffff|111827)$/)
    expect(vars['--on-accent-600']).toMatch(/^#(ffffff|111827)$/)
    expect(vars['--secondary-500']).toBeUndefined()
    expect(vars['--on-secondary-500']).toBeUndefined()
  })

  it('picks white ink on a dark fill and near-black on a light fill', () => {
    const dark = themeCssVars(normalizeTheme({ primary: '#111111' }))
    const light = themeCssVars(normalizeTheme({ primary: '#eeeeee' }))
    expect(dark['--on-primary-500']).toBe('#ffffff')
    expect(light['--on-primary-500']).toBe('#111827')
  })

  it('maps fonts, radius, button radius and spacing', () => {
    expect(vars['--font-display']).toBe("'Bebas Neue'")
    expect(vars['--font-body']).toBe("'Inter'")
    expect(vars['--radius-card']).toBe('12px') // md
    expect(vars['--space-scale']).toBe('1') // comfortable
  })

  it('uses the pill button radius override', () => {
    const v = themeCssVars(normalizeTheme({ buttonStyle: 'pill' }))
    expect(v['--radius-button']).toBe('999px')
  })

  it('downgrades a full radius to lg for the button when not pill', () => {
    const v = themeCssVars(normalizeTheme({ radius: 'full', buttonStyle: 'solid' }))
    expect(v['--radius-card']).toBe('28px') // full
    expect(v['--radius-button']).toBe('20px') // lg
  })

  it('uses the card radius for a solid button at a non-full radius', () => {
    const v = themeCssVars(normalizeTheme({ radius: 'sm', buttonStyle: 'solid' }))
    expect(v['--radius-button']).toBe('6px')
  })
})

describe('styleCssVars', () => {
  it('emits nothing when no style tokens are set', () => {
    expect(styleCssVars(DEFAULT_THEME)).toEqual({})
  })

  it('sets button radii per shape', () => {
    expect(styleCssVars(normalizeTheme({ buttonShape: 'square' }))['--ui-btn-radius']).toBe('0px')
    expect(styleCssVars(normalizeTheme({ buttonShape: 'pill' }))['--ui-btn-radius']).toBe('999px')
    // rounded -> control radius for the theme's corner size (md control = 8px)
    expect(styleCssVars(normalizeTheme({ buttonShape: 'rounded' }))['--ui-btn-radius']).toBe('8px')
    expect(styleCssVars(normalizeTheme({ buttonShape: 'square' }))['--ui-badge-radius']).toBe('2px')
    expect(styleCssVars(normalizeTheme({ buttonShape: 'rounded' }))['--ui-badge-radius']).toBe('6px')
  })

  it('sets card vars per style, incl. the outlined border and flat bg', () => {
    const outlined = styleCssVars(normalizeTheme({ cardStyle: 'outlined' }))
    expect(outlined['--ui-card-border-width']).toBe('1px')
    expect(outlined['--ui-card-border']).toBe('var(--color-border)')
    expect(outlined['--ui-card-shadow']).toBe('none')

    const flat = styleCssVars(normalizeTheme({ cardStyle: 'flat' }))
    expect(flat['--ui-card-border-width']).toBe('0px')
    expect(flat['--ui-card-bg']).toBe('var(--color-surface-secondary)')

    const shadow = styleCssVars(normalizeTheme({ cardStyle: 'shadow' }))
    expect(shadow['--ui-card-shadow']).not.toBe('none')
  })

  it('uses the explicit shadow depth for a shadow card, else soft default', () => {
    const strongCard = styleCssVars(normalizeTheme({ cardStyle: 'shadow', shadow: 'strong' }))
    const softCard = styleCssVars(normalizeTheme({ cardStyle: 'shadow' }))
    expect(strongCard['--ui-card-shadow']).not.toBe(softCard['--ui-card-shadow'])
  })

  it('sets the shadow pair when shadow is set, and none for none', () => {
    const soft = styleCssVars(normalizeTheme({ shadow: 'soft' }))
    expect(soft['--ui-shadow']).toContain('rgb')
    expect(soft['--ui-shadow-raised']).toContain('rgb')
    const none = styleCssVars(normalizeTheme({ shadow: 'none' }))
    expect(none['--ui-shadow']).toBe('none')
  })

  it('sets input vars per style', () => {
    const underline = styleCssVars(normalizeTheme({ inputStyle: 'underline' }))
    expect(underline['--ui-input-radius']).toBe('0px')
    expect(underline['--ui-input-bg']).toBe('transparent')
    expect(underline['--ui-input-border-width']).toBe('0 0 1px')
    expect(underline['--ui-addon-border-width']).toBe('0 0 1px')

    const filled = styleCssVars(normalizeTheme({ inputStyle: 'filled' }))
    expect(filled['--ui-input-bg']).toBe('var(--color-surface-secondary)')
    expect(filled['--ui-input-border']).toBe('transparent')
    expect(filled['--ui-input-border-width']).toBe('1px')
    expect(filled['--ui-addon-border-width']).toBeUndefined()

    const outlined = styleCssVars(normalizeTheme({ inputStyle: 'outlined' }))
    expect(outlined['--ui-input-bg']).toBe('var(--color-surface)')
  })

  it('sets heading font + weight override for a no-bold display face', () => {
    // Bebas Neue has only weight 400 -> heading weight forced to 400.
    const v = styleCssVars(normalizeTheme({ fontDisplay: 'Bebas Neue', headingCase: 'upper' }))
    expect(v['--ui-heading-font']).toBe("'Bebas Neue', Georgia, serif")
    expect(v['--ui-heading-weight']).toBe('400')
    expect(v['--ui-heading-case']).toBe('uppercase')
  })

  it('does not force the heading weight for a face with a 700 weight', () => {
    const v = styleCssVars(normalizeTheme({ fontDisplay: 'Inter', headingTracking: 'wide' }))
    expect(v['--ui-heading-weight']).toBeUndefined()
    expect(v['--ui-heading-tracking']).toBe('0.06em')
  })

  it('sets heading case normal -> none', () => {
    expect(styleCssVars(normalizeTheme({ headingCase: 'normal' }))['--ui-heading-case']).toBe('none')
  })
})

describe('googleFontsHref', () => {
  it('builds a css2 href with both families and + for spaces', () => {
    const href = googleFontsHref(normalizeTheme({ fontDisplay: 'Playfair Display', fontBody: 'Inter' }))
    expect(href).toContain('family=Playfair+Display:wght@400;600;700')
    expect(href).toContain('family=Inter:wght@400;500;600;700')
    expect(href).toContain('&display=swap')
  })
  it('de-dupes when both fonts are the same', () => {
    const href = googleFontsHref(normalizeTheme({ fontDisplay: 'Inter', fontBody: 'Inter' }))
    expect(href.match(/family=/g)).toHaveLength(1)
  })
})

describe('cssVarsRule', () => {
  it('wraps the vars in a selector block joined by semicolons', () => {
    expect(cssVarsRule(':root', { '--a': '1', '--b': '2' })).toBe(':root{--a:1;--b:2}')
  })
  it('handles an empty var map', () => {
    expect(cssVarsRule('.x', {})).toBe('.x{}')
  })
})

describe('FONT_CHOICES', () => {
  it('includes the default fonts', () => {
    expect(FONT_CHOICES.some(f => f.name === 'Inter')).toBe(true)
    expect(FONT_CHOICES.some(f => f.name === 'Bebas Neue')).toBe(true)
  })
})
