import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const DIR = join(process.cwd(), 'src/components/admin/homepage')
const EDITORS = join(DIR, 'editors')

function allSources(): { file: string; src: string }[] {
  const out: { file: string; src: string }[] = []
  for (const f of readdirSync(EDITORS)) {
    if (f.endsWith('.tsx')) out.push({ file: `editors/${f}`, src: readFileSync(join(EDITORS, f), 'utf8') })
  }
  out.push({ file: 'SectionConfigFields.tsx', src: readFileSync(join(DIR, 'SectionConfigFields.tsx'), 'utf8') })
  return out
}

describe('section editors use the project control components', () => {
  const sources = allSources()

  it('never uses a raw <select>', () => {
    for (const { file, src } of sources) expect(`${file}:${src.includes('<select')}`).toBe(`${file}:false`)
  })

  it('never uses a raw date or datetime input', () => {
    for (const { file, src } of sources) {
      expect(`${file}:${src.includes('type="date')}`).toBe(`${file}:false`)
      expect(`${file}:${src.includes('datetime-local')}`).toBe(`${file}:false`)
    }
  })

  it('never uses a raw <img>', () => {
    for (const { file, src } of sources) expect(`${file}:${src.includes('<img')}`).toBe(`${file}:false`)
  })

  it('routes dropdowns through AdminSelect and dates through DateTimePicker', () => {
    const fields = sources.find(s => s.file === 'editors/fields.tsx')!.src
    expect(fields).toContain('AdminSelect')
    expect(fields).toContain('DateTimePicker')
  })

  it('renders image previews with BlurHash', () => {
    const promo = sources.find(s => s.file === 'editors/PromoBannerEditor.tsx')!.src
    expect(promo).toContain('AdminImage')
    expect(promo).toContain('blurhash')
  })
})

// Regression: the previous shared component fed `new Date(iso).toISOString().slice(0,16)` into a
// control the user reads as local time, so a stored instant came back shifted by the UTC offset —
// a banner scheduled for midnight IST displayed as 18:30 the previous day.
describe('schedule date conversion', () => {
  const isoToLocal = (iso: string | null): string => {
    if (!iso) return ''
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  const localToIso = (local: string): string | null => {
    if (!local) return null
    const d = new Date(local)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }

  it('round-trips an instant unchanged', () => {
    for (const iso of ['2026-11-01T18:30:00.000Z', '2026-01-01T00:00:00.000Z', '2026-06-15T12:00:00.000Z']) {
      expect(new Date(localToIso(isoToLocal(iso))!).getTime()).toBe(new Date(iso).getTime())
    }
  })

  it('displays local wall-clock time, not UTC', () => {
    const iso = '2026-11-01T18:30:00.000Z'
    const d = new Date(iso)
    const pad = (n: number) => String(n).padStart(2, '0')
    expect(isoToLocal(iso)).toBe(
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    )
  })

  it('treats empty and invalid values as no date', () => {
    expect(isoToLocal(null)).toBe('')
    expect(isoToLocal('nonsense')).toBe('')
    expect(localToIso('')).toBeNull()
    expect(localToIso('nonsense')).toBeNull()
  })

  it('keeps the source helpers in sync with this test', () => {
    const fields = readFileSync(join(EDITORS, 'fields.tsx'), 'utf8')
    expect(fields).toContain('function isoToLocal')
    expect(fields).toContain('function localToIso')
    expect(fields).not.toContain('toISOString().slice(0, 16)')
  })
})

describe('editor coverage', () => {
  it('maps every non-hero section type to an editor', () => {
    const config = readFileSync(join(DIR, 'SectionConfigFields.tsx'), 'utf8')
    for (const type of [
      'about',
      'benefits',
      'brand_carousel',
      'business_cta',
      'category_grid',
      'category_showcase',
      'deal_of_the_day',
      'featured_for_you',
      'product_row',
      'promo_banner',
      'trust_strip',
      'why_us',
      'countdown_deal',
      'testimonials',
      'recently_viewed',
      'category_tabs',
      'bundle_spotlight',
      'back_in_stock',
      'blog_teaser',
      'social_strip',
      'value_stats',
    ]) {
      expect(config).toContain(`${type}:`)
    }
  })

  it('leaves hero to the embedded slide editor', () => {
    const config = readFileSync(join(DIR, 'SectionConfigFields.tsx'), 'utf8')
    expect(config).not.toMatch(/^\s*hero:/m)
  })

  it('shows scheduling for every type, including hero', () => {
    const config = readFileSync(join(DIR, 'SectionConfigFields.tsx'), 'utf8')
    expect(config).toContain('<Scheduling')
  })
})
