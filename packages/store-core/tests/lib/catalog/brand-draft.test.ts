import { describe, it, expect, vi, beforeEach } from 'vitest'

// Only mergeAndPublish is mocked; entity-fields and brand-fields are real pure logic.
vi.mock('@/lib/admin/draft-branches', () => ({ mergeAndPublish: vi.fn().mockResolvedValue('merged') }))

import {
  applyBrandProfile,
  applyBrandContent,
  brandContentOf,
  liveBrandContent,
  brandDrafts,
  publishBrandDraft,
} from '@/lib/catalog/brand-draft'
import { mergeAndPublish } from '@/lib/admin/draft-branches'

function db(...rows: any[][]) {
  let i = 0
  const calls: { sql: string; params: any[] }[] = []
  return {
    calls,
    query: vi.fn(async (sql: string, params: any[] = []) => {
      calls.push({ sql, params })
      return { rows: rows[i++] ?? [] }
    }),
  }
}

beforeEach(() => vi.clearAllMocks())

describe('applyBrandProfile', () => {
  it('writes only the profile columns present in the fields, params offset at 2', async () => {
    const d = db([])
    await applyBrandProfile(d as any, 'b1', { legal_name: 'Acme Inc', founded_year: '1990' })
    expect(d.query).toHaveBeenCalledTimes(1)
    const { sql, params } = d.calls[0]
    expect(sql).toMatch(/^UPDATE brands SET /)
    expect(sql).toContain('legal_name = $2::text')
    expect(sql).toContain('founded_year = $3::integer')
    expect(params[0]).toBe('b1')
    expect(params).toContain('Acme Inc')
    expect(params).toContain(1990)
  })

  it('writes nothing when no profile fields are present', async () => {
    const d = db()
    await applyBrandProfile(d as any, 'b1', { name: 'x' }) // name is a base col, not a profile field
    expect(d.query).not.toHaveBeenCalled()
  })
})

describe('applyBrandContent', () => {
  it('updates the live row, applies the profile, and does not cascade when is_active unchanged', async () => {
    const d = db([], []) // content UPDATE, profile UPDATE
    await applyBrandContent(d as any, 'b1', { name: 'Acme', description: 'd', legal_name: 'Acme Inc' }, true)
    // content update + one profile update; no products cascade
    expect(d.query).toHaveBeenCalledTimes(2)
    const { sql, params } = d.calls[0]
    expect(sql).toContain('UPDATE brands SET')
    expect(sql).toContain('is_draft = false')
    expect(params[0]).toBe('b1')
    expect(params[1]).toBe('Acme') // f.name || null
    expect(params[2]).toBe('acme') // slug derived from name
  })

  it('derives a slug from the name when none supplied, null when name blank', async () => {
    const d = db([], [])
    await applyBrandContent(d as any, 'b1', { name: 'Bright & Bold!' }, null)
    expect(d.calls[0].params[2]).toBe('bright-bold')

    const d2 = db([], [])
    await applyBrandContent(d2 as any, 'b1', {}, null)
    expect(d2.calls[0].params[1]).toBeNull() // name
    expect(d2.calls[0].params[2]).toBeNull() // slug
  })

  it('parses window-day integers and passes through null when absent', async () => {
    const d = db([], [])
    await applyBrandContent(
      d as any,
      'b1',
      { return_allowed: true, return_window_days: '7', replacement_allowed: false, replacement_window_days: '14' },
      true
    )
    const p = d.calls[0].params
    expect(p[7]).toBe(true) // return_allowed
    expect(p[8]).toBe(7) // return_window_days parsed
    expect(p[9]).toBe(false) // replacement_allowed
    expect(p[10]).toBe(14)
  })

  it('cascades is_active to the brand products when it changes', async () => {
    const d = db([], [], []) // content, profile, products cascade
    await applyBrandContent(d as any, 'b1', { is_active: false, legal_name: 'Acme Inc' }, true)
    expect(d.query).toHaveBeenCalledTimes(3)
    const cascade = d.calls[2]
    expect(cascade.sql).toContain('UPDATE products SET is_active = $1 WHERE brand_id = $2')
    expect(cascade.params).toEqual([false, 'b1'])
  })

  it('does not cascade when is_active equals the previous value', async () => {
    const d = db([], [])
    await applyBrandContent(d as any, 'b1', { is_active: true, legal_name: 'Acme Inc' }, true)
    expect(d.query).toHaveBeenCalledTimes(2)
  })
})

describe('brandContentOf', () => {
  it('pulls the base columns (null-filled) plus the parsed profile fields', () => {
    const c = brandContentOf({ name: 'Acme', slug: 'acme', is_active: true, legal_name: 'Acme Inc', founded_year: 1990 })
    expect(c.name).toBe('Acme')
    expect(c.description).toBeNull() // base col absent → null
    expect(c.legal_name).toBe('Acme Inc')
    expect(c.founded_year).toBe(1990)
  })
})

describe('liveBrandContent', () => {
  it('selects the content columns and shapes the row, null when not found', async () => {
    const d = db([{ name: 'Acme', slug: 'acme', description: null, legal_name: 'Acme Inc' }])
    const c = await liveBrandContent(d as any, 'b1')
    expect(c?.name).toBe('Acme')
    expect(d.calls[0].sql).toMatch(/^SELECT .* FROM brands WHERE id = \$1/)
    expect(d.calls[0].params).toEqual(['b1'])

    const empty = db([])
    expect(await liveBrandContent(empty as any, 'b1')).toBeNull()
  })
})

describe('brandDrafts adapter', () => {
  it('has the expected identity and labels', () => {
    expect(brandDrafts.type).toBe('brand')
    expect(brandDrafts.table).toBe('brand_drafts')
    expect(brandDrafts.entityKey).toBe('brand_id')
    const labels = brandDrafts.labels!
    expect(labels.logo_url).toBe('Logo')
    expect(labels.is_active).toBe('Active')
    // profile field labels merged in
    expect(labels.legal_name).toBe('Legal name')
  })

  it('toContent keeps only the form fields present in the draft', () => {
    const content = brandDrafts.toContent!({
      fields: { name: 'Acme', legal_name: 'Acme Inc', is_draft: true, bogus: 1 },
    } as any)
    expect(content).toHaveProperty('name', 'Acme')
    expect(content).toHaveProperty('legal_name', 'Acme Inc')
    expect(content).not.toHaveProperty('is_draft')
    expect(content).not.toHaveProperty('bogus')
  })

  it('toContent handles a missing fields object', () => {
    expect(brandDrafts.toContent!({} as any)).toEqual({})
  })

  it('toColumns wraps content under fields', () => {
    expect(brandDrafts.toColumns!({ name: 'Acme' })).toEqual({ fields: { name: 'Acme' } })
  })

  it('lockLive issues a FOR UPDATE on the brand row', async () => {
    const d = db([])
    await brandDrafts.lockLive!(d as any, 'b1')
    expect(d.calls[0].sql).toContain('SELECT 1 FROM brands WHERE id = $1 FOR UPDATE')
    expect(d.calls[0].params).toEqual(['b1'])
  })

  it('apply forwards to applyBrandContent with live.is_active', async () => {
    const d = db([], [])
    await (brandDrafts.apply as any)(d as any, 'b1', { name: 'Acme' }, { is_active: false } as any)
    // content UPDATE ran; prevIsActive=false, merged has no is_active → no cascade
    expect(d.calls[0].sql).toContain('UPDATE brands SET')
  })
})

describe('publishBrandDraft', () => {
  it('delegates to mergeAndPublish with the adapter, draft id, actor and opts', async () => {
    const opts = { actor: { id: 'u1' } as any, resolutions: {}, epoch: 3 }
    const r = await publishBrandDraft('d1', opts)
    expect(r).toBe('merged')
    expect(mergeAndPublish).toHaveBeenCalledWith(brandDrafts, 'd1', opts.actor, opts)
  })

  it('works with default opts', async () => {
    await publishBrandDraft('d1')
    expect(mergeAndPublish).toHaveBeenCalledWith(brandDrafts, 'd1', undefined, {})
  })
})
