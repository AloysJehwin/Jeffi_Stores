import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({
  queryMany: vi.fn(),
}))

vi.mock('next/server', () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => new Response(JSON.stringify(body), { status: init?.status ?? 200 }) },
}))

import { buildAttributeFilterClauses, getAttributeValues, attributeValuesResponse, getSpecFilterFields } from '@/lib/catalog/product-attribute-filters'
import { queryMany } from '@/lib/shared/db'

describe('buildAttributeFilterClauses', () => {
  it('returns nothing for empty params, preserving nextIdx', () => {
    const r = buildAttributeFilterClauses({}, 4)
    expect(r.conditions).toEqual([])
    expect(r.params).toEqual([])
    expect(r.nextIdx).toBe(4)
  })

  it('binds a toggle as a boolean literal param', () => {
    const r = buildAttributeFilterClauses({ is_featured: 'true', is_digital: 'false' }, 1)
    expect(r.conditions).toContain('p.is_featured = $1')
    expect(r.conditions).toContain('p.is_digital = $2')
    expect(r.params).toEqual([true, false])
    // a non true/false toggle value is ignored
    expect(buildAttributeFilterClauses({ is_featured: 'maybe' }, 1).conditions).toEqual([])
  })

  it('inlines flag booleans without params', () => {
    const r = buildAttributeFilterClauses({ fragile: 'true', hazardous: 'false' }, 1)
    expect(r.conditions).toContain('p.fragile = true')
    expect(r.conditions).toContain('p.hazardous = false')
    expect(r.params).toEqual([])
  })

  it('builds a case-insensitive multi IN for text and numeric cast for numbers', () => {
    const r = buildAttributeFilterClauses({ condition: 'new|used', gst_percentage: '18|bad|5' }, 1)
    const cond = r.conditions.find(c => c.includes('p.condition'))!
    expect(cond).toContain('lower(btrim(p.condition)) IN (lower($1), lower($2))')
    const gst = r.conditions.find(c => c.includes('p.gst_percentage'))!
    // 'bad' is filtered out as non-numeric
    expect(gst).toBe('p.gst_percentage IN ($3::numeric, $4::numeric)')
    expect(r.params).toEqual(['new', 'used', '18', '5'])
  })

  it('builds numeric range bounds', () => {
    const r = buildAttributeFilterClauses({ price_min: '10', price_max: '100', stock_min: 'x' }, 1)
    const mins = r.conditions.filter(c => c.includes('>='))
    const maxs = r.conditions.filter(c => c.includes('<='))
    expect(mins[0]).toContain('>= $1::numeric')
    expect(maxs[0]).toContain('<= $2::numeric')
    expect(r.params).toEqual(['10', '100']) // stock_min 'x' not numeric
  })

  it('accepts ISO date range only', () => {
    const r = buildAttributeFilterClauses({ created_from: '2026-01-01', created_to: 'nope' }, 1)
    expect(r.conditions.some(c => c.includes('p.created_at >= $1::date'))).toBe(true)
    expect(r.conditions.some(c => c.includes('created_at <'))).toBe(false)
    expect(r.params).toEqual(['2026-01-01'])
  })

  it('builds a simple column match for a plain value source', () => {
    const r = buildAttributeFilterClauses({ tax_class: 'gst5' }, 1)
    // tax_class has an expr only (no specKeys/arrayExpr/splitList)
    expect(r.conditions[0]).toBe('lower(btrim(p.tax_class)) IN (lower($1))')
    expect(r.params).toEqual(['gst5'])
  })

  it('builds an EXISTS match for a source with spec aliases', () => {
    const r = buildAttributeFilterClauses({ material: 'steel' }, 1)
    expect(r.conditions[0]).toContain('EXISTS (SELECT 1 FROM (')
    expect(r.conditions[0]).toContain('UNION ALL') // expr + spec rows
    expect(r.conditions[0]).toContain('lower(s.val) IN (lower($1))')
    expect(r.params).toContain('steel')
  })

  it('folds country_of_origin to upper case', () => {
    const r = buildAttributeFilterClauses({ country_of_origin: 'in' }, 1)
    expect(r.conditions[0]).toBe('upper(btrim(p.country_of_origin)) IN (upper($1))')
  })

  it('handles an arrayExpr source via unnest', () => {
    const r = buildAttributeFilterClauses({ certifications: 'iso' }, 1)
    expect(r.conditions[0]).toContain('unnest(p.certifications)')
  })

  it('builds a dynamic spec. param through sourceFor', () => {
    const r = buildAttributeFilterClauses({ 'spec.thread_size': 'm6' }, 1)
    expect(r.conditions[0]).toContain('EXISTS')
    expect(r.params).toContain('m6')
  })

  it('caps spec filters and sorts them', () => {
    const sp: Record<string, unknown> = {}
    for (let n = 0; n < 40; n++) sp[`spec.k${String(n).padStart(2, '0')}`] = 'v'
    const r = buildAttributeFilterClauses(sp, 1)
    // 30 spec filters max
    expect(r.conditions.length).toBe(30)
  })
})

describe('getAttributeValues', () => {
  beforeEach(() => vi.mocked(queryMany).mockReset().mockResolvedValue([]))

  it('returns null for an unknown field', async () => {
    expect(await getAttributeValues('nope', '', 1)).toBeNull()
    expect(queryMany).not.toHaveBeenCalled()
  })

  it('queries a known field with page offset and no search', async () => {
    vi.mocked(queryMany).mockResolvedValue([{ value: 'Steel', count: 3 }])
    const out = await getAttributeValues('material', '', 2)
    expect(out).toEqual([{ value: 'Steel', count: 3 }])
    const [sql, params] = vi.mocked(queryMany).mock.calls[0] as [string, any[]]
    expect(String(sql)).toContain('OFFSET')
    // page 2 -> offset 50 is the last bound param
    expect(params[params.length - 1]).toBe(50)
  })

  it('escapes and appends a search ILIKE', async () => {
    await getAttributeValues('material', '50%_x', 1)
    const [sql, params] = vi.mocked(queryMany).mock.calls[0]
    expect(String(sql)).toContain('ILIKE')
    expect(params).toContain('%50\\%\\_x%')
  })

  it('clamps page to at least 1 (offset 0)', async () => {
    await getAttributeValues('material', '', 0)
    const params = vi.mocked(queryMany).mock.calls[0][1] as any[]
    expect(params[params.length - 1]).toBe(0)
  })
})

describe('attributeValuesResponse', () => {
  beforeEach(() => vi.mocked(queryMany).mockReset().mockResolvedValue([]))

  it('400s on an invalid field', async () => {
    const req = { url: 'http://x/api?field=nope' } as any
    const res = await attributeValuesResponse(req)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid field' })
  })

  it('returns values and the field on success', async () => {
    vi.mocked(queryMany).mockResolvedValue([{ value: 'Steel', count: 1 }])
    const req = { url: 'http://x/api?field=material&search=st&page=2' } as any
    const res = await attributeValuesResponse(req)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ values: [{ value: 'Steel', count: 1 }], field: 'material' })
  })
})

describe('getSpecFilterFields', () => {
  beforeEach(() => vi.mocked(queryMany).mockReset())

  it('maps rows into value-help fields, dropping aliased keys', async () => {
    vi.mocked(queryMany).mockResolvedValue([
      { key: 'thread size', label: 'Thread Size', raw: 'Thread Size' },
      { key: 'material', label: 'Material', raw: 'Material' }, // aliased -> dropped
      { key: 'length', label: null, raw: 'length' }, // label from specLabel(raw)
    ])
    const fields = await getSpecFilterFields(3)
    expect(fields).toHaveLength(2)
    expect(fields[0]).toMatchObject({ name: 'spec.thread_size', label: 'Thread Size', type: 'value-help' })
    expect(fields[1].name).toBe('spec.length')
    const [, params] = vi.mocked(queryMany).mock.calls[0]
    expect(params).toEqual([3])
  })

  it('swallows a query error and returns no fields', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(queryMany).mockImplementationOnce(() => {
      const p = Promise.reject(new Error('boom'))
      return p
    })
    await expect(getSpecFilterFields()).resolves.toEqual([])
    spy.mockRestore()
  })
})
