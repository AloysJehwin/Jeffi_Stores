import { describe, it, expect, vi } from 'vitest'
import {
  listFamilies, listTemplates, listTemplatesWithDefaults, findBySlug, findBySlugWithDefaults,
  findPlatformBySlug, findById, listVersions, liveVersion, upsertTemplate, publishVersion,
  archiveTemplate, setApprovalStatus, toApi, PLATFORM_TENANT_ID,
} from '../src/templates-v2'

// A fake pg executor: route(sql) returns the rows for a query matched by substring.
function exec(route: (sql: string, params: any[]) => any[] | undefined) {
  const query = vi.fn(async (sql: string, params: any[] = []) => ({ rows: route(sql, params) ?? [], rowCount: (route(sql, params) ?? []).length }))
  return { query }
}

const tmpl = (over: any = {}) => ({
  id: 't1', family_id: 'f1', tenant_id: 'ten1', channel: 'email', current_variant_id: 'v1', status: 'active', ...over,
})

describe('templates-v2 reads', () => {
  it('listFamilies / listTemplates pass the space + filters through', async () => {
    const e = exec(sql => sql.includes('FROM template_family') ? [{ id: 'f1', slug: 's', name: 'N' }] : sql.includes('FROM template t') ? [tmpl()] : [])
    expect(await listFamilies(e as any, 'ten1', 'email', 'orders', 'api')).toEqual([{ id: 'f1', slug: 's', name: 'N' }])
    expect(e.query.mock.calls[0][1]).toEqual(['ten1', 'email', 'orders', 'api'])
    await listTemplates(e as any, 'ten1', undefined, 'store', true)
    expect(e.query.mock.calls[1][1]).toEqual(['ten1', null, 'store', true])
  })

  it('findBySlug walks family→template→variant→version, honoring current_variant_id fallback', async () => {
    const e = exec(sql => {
      if (sql.includes('FROM template_family WHERE tenant_id')) return [{ id: 'f1', slug: 'welcome', tenant_id: 'ten1' }]
      if (sql.includes('FROM template WHERE family_id')) return [tmpl({ current_variant_id: 'v9' })]
      if (sql.includes('template_variant WHERE template_id')) return [] // no locale match
      if (sql.includes('template_variant WHERE id=$1')) return [{ id: 'v9', current_version_id: 'ver9' }]
      if (sql.includes('template_version WHERE id=$1')) return [{ id: 'ver9', body: 'hi' }]
      return []
    })
    const t = await findBySlug(e as any, 'ten1', 'email', 'welcome')
    expect(t?.variant.id).toBe('v9')
    expect(t?.version?.body).toBe('hi')
  })

  it('findBySlug returns null when family or template is missing', async () => {
    expect(await findBySlug(exec(() => []) as any, 'ten1', 'email', 'nope')).toBeNull()
    const noTemplate = exec(sql => sql.includes('template_family') ? [{ id: 'f1' }] : [])
    expect(await findBySlug(noTemplate as any, 'ten1', 'email', 's')).toBeNull()
  })

  it('findById reads by template id, returns a null variant when none exists', async () => {
    const e = exec(sql => {
      if (sql.includes('FROM template WHERE id=$1')) return [tmpl({ current_variant_id: null })]
      if (sql.includes('template_family WHERE id=$1')) return [{ id: 'f1', space: 'store' }]
      return [] // no variant
    })
    const t = await findById(e as any, 'ten1', 't1')
    expect(t?.variant).toBeNull()
    expect(t?.version).toBeNull()
  })

  it('listVersions and liveVersion target the right rows', async () => {
    const e = exec(sql => sql.includes('ORDER BY version DESC') ? [{ version: 3 }, { version: 2 }] : [])
    expect(await listVersions(e as any, 'v1')).toHaveLength(2)
    const e2 = exec(() => [{ id: 'verX', provider_ref: 'HX1' }])
    expect((await liveVersion(e2 as any, 'v1', 'HX1'))?.id).toBe('verX')
  })
})

describe('listTemplatesWithDefaults (tenant shadows platform)', () => {
  const plat = { tenant: null as any, platform: null as any }

  it('platform tenant: returns its own, all tagged source=platform', async () => {
    const own = exec(() => [{ slug: 'a', channel: 'email', name: 'A', tags: [] }])
    const r = await listTemplatesWithDefaults({ tenant: own, platform: own } as any, PLATFORM_TENANT_ID)
    expect(r).toEqual([{ slug: 'a', channel: 'email', name: 'A', tags: [], source: 'platform' }])
  })

  it('a tenant merges its rows over the platform defaults by slug|channel, tenant wins', async () => {
    const tenant = exec(() => [{ slug: 'order', channel: 'email', name: 'Order (custom)', tags: ['page:order'] }])
    const platform = exec(() => [
      { slug: 'order', channel: 'email', name: 'Order', tags: ['page:order'] },
      { slug: 'welcome', channel: 'email', name: 'Welcome', tags: [] },
    ])
    const r = await listTemplatesWithDefaults({ tenant, platform } as any, 'ten1')
    expect(r.map((x: any) => [x.name, x.source])).toEqual([
      ['Order (custom)', 'tenant'],
      ['Welcome', 'platform'],
    ])
  })

  it('a tenant row with no tags inherits its default tags; ?tag filters the result', async () => {
    const tenant = exec(() => [{ slug: 'order', channel: 'email', name: 'O', tags: [] }])
    const platform = exec(() => [{ slug: 'order', channel: 'email', name: 'O', tags: ['page:order'] }])
    const kept = await listTemplatesWithDefaults({ tenant, platform } as any, 'ten1', undefined, 'store', { tag: 'page:order' })
    expect(kept).toHaveLength(1)
    expect((kept[0] as any).tags).toEqual(['page:order'])
    const dropped = await listTemplatesWithDefaults({ tenant, platform } as any, 'ten1', undefined, 'store', { tag: 'page:checkout' })
    expect(dropped).toEqual([])
  })

  it('a tenant DB missing the tables (42P01) yields the platform defaults only', async () => {
    const tenant = { query: vi.fn(async () => { throw Object.assign(new Error('no table'), { code: '42P01' }) }) }
    const platform = exec(() => [{ slug: 'welcome', channel: 'email', name: 'W', tags: [] }])
    const r = await listTemplatesWithDefaults({ tenant, platform } as any, 'ten1')
    expect(r.map((x: any) => x.source)).toEqual(['platform'])
  })

  it('a non-42P01 error from the tenant pool propagates', async () => {
    const tenant = { query: vi.fn(async () => { throw new Error('boom') }) }
    await expect(listTemplatesWithDefaults({ tenant, platform: tenant } as any, 'ten1')).rejects.toThrow('boom')
  })
})

describe('findBySlugWithDefaults / findPlatformBySlug', () => {
  it('returns the tenant copy when it exists', async () => {
    const tenant = exec(sql => {
      if (sql.includes('template_family')) return [{ id: 'f1', slug: 's', tenant_id: 'ten1' }]
      if (sql.includes('FROM template WHERE')) return [tmpl()]
      if (sql.includes('template_variant WHERE template_id')) return [{ id: 'v1', current_version_id: null }]
      return []
    })
    const t = await findBySlugWithDefaults({ tenant, platform: exec(() => []) } as any, 'ten1', 'email', 's')
    expect(t?.template.id).toBe('t1')
  })

  it('falls back to the platform default when the tenant has none', async () => {
    const tenant = exec(() => []) // no family
    const platform = exec(sql => {
      if (sql.includes('template_family')) return [{ id: 'pf', slug: 's', tenant_id: PLATFORM_TENANT_ID }]
      if (sql.includes('FROM template WHERE')) return [tmpl({ id: 'pt', current_variant_id: 'pv' })]
      if (sql.includes('template_variant WHERE template_id')) return [{ id: 'pv', current_version_id: null }]
      return []
    })
    const t = await findBySlugWithDefaults({ tenant, platform } as any, 'ten1', 'email', 's')
    expect(t?.template.id).toBe('pt')
    // findPlatformBySlug always uses the platform pool
    const p = await findPlatformBySlug({ tenant, platform } as any, 'email', 's')
    expect(p?.template.id).toBe('pt')
  })

  it('a 42P01 on the tenant pool is treated as no tenant copy', async () => {
    const tenant = { query: vi.fn(async () => { throw Object.assign(new Error('x'), { code: '42P01' }) }) }
    const platform = exec(() => [])
    expect(await findBySlugWithDefaults({ tenant, platform } as any, 'ten1', 'email', 's')).toBeNull()
  })
})

describe('upsertTemplate', () => {
  // A fake pool.connect() → client that records BEGIN/COMMIT/ROLLBACK and serves rows by SQL.
  function pool(route: (sql: string, params: any[]) => any[] | undefined) {
    const log: string[] = []
    const client = {
      query: vi.fn(async (sql: string, params: any[] = []) => { log.push(sql.trim().split(/\s+/).slice(0, 2).join(' ')); return { rows: route(sql, params) ?? [], rowCount: 1 } }),
      release: vi.fn(),
    }
    return { connect: vi.fn(async () => client), client, log }
  }
  const baseRoute = (over: any = {}) => (sql: string) => {
    if (sql.includes('INSERT INTO template_family')) return [{ id: 'f1', slug: 's', name: 'N', tags: [] }]
    if (sql.includes('INSERT INTO template ')) return [tmpl({ current_variant_id: over.existingVariant ? 'v1' : null })]
    if (sql.includes('FROM template_variant WHERE template_id')) return over.existingVariant ? [over.existingVariant] : []
    if (sql.includes('INSERT INTO template_variant')) return [{ id: 'v1', current_version_id: null, ...over.variant }]
    if (sql.includes('COALESCE(MAX(version)')) return [{ max: over.maxV ?? 0 }]
    if (sql.includes('INSERT INTO template_version')) return [{ id: 'ver1', version: (over.maxV ?? 0) + 1, body: 'b', layout: 'store' }]
    return []
  }

  it('inserts family→template→variant→version, publishes, and commits', async () => {
    const p = pool(baseRoute())
    const r = await upsertTemplate(p as any, 'ten1', { slug: 's', channel: 'email', name: 'N', body: 'Hi {{name}}', subject: 'S {{x}}' })
    expect(r.version?.version).toBe(1)
    expect(p.log[0]).toBe('BEGIN')
    expect(p.log.at(-1)).toBe('COMMIT')
    expect(p.client.release).toHaveBeenCalled()
    // variables collected from subject + body
    const verInsert = p.client.query.mock.calls.find(c => String(c[0]).includes('INSERT INTO template_version'))!
    expect(verInsert[1]![6]).toEqual(expect.arrayContaining(['name', 'x']))
  })

  it('stores an SMS DLT template id in sms_dlt_template (route from category), removes it when emptied, and exposes it through toApi', async () => {
    const p = pool((sql, params) => sql.includes('FROM sms_dlt_template t') ? [{ dlt_template_id: 'T1', dlt_header: '', dlt_route: 'promotional', default_header: 'JEFFIS' }] : baseRoute()(sql))
    const r = await upsertTemplate(p as any, 'ten1', { slug: 's', channel: 'sms', name: 'N', category: 'marketing', body: 'b', dlt_template_id: ' T1 ' })
    const ins = p.client.query.mock.calls.find(c => String(c[0]).includes('INSERT INTO sms_dlt_template'))!
    expect(ins[1]).toEqual(['v1', 'T1', null, 'promotional', false])
    expect(toApi({ ...r, version: null })).toMatchObject({ dlt_template_id: 'T1', dlt_header: 'JEFFIS', dlt_route: 'promotional' })
    const q = pool(baseRoute())
    await upsertTemplate(q as any, 'ten1', { slug: 's', channel: 'sms', name: 'N', body: 'b', dlt_template_id: '' })
    expect(q.client.query.mock.calls.some(c => String(c[0]).includes('DELETE FROM sms_dlt_template'))).toBe(true)
    const keep = pool(baseRoute())
    await upsertTemplate(keep as any, 'ten1', { slug: 's', channel: 'sms', name: 'N', body: 'b' })
    expect(keep.client.query.mock.calls.some(c => String(c[0]).includes('sms_dlt_template') && !String(c[0]).includes('FROM sms_dlt_template t'))).toBe(false)
  })

  it('skips the publish UPDATE when publish:false', async () => {
    const p = pool(baseRoute())
    await upsertTemplate(p as any, 'ten1', { slug: 's', channel: 'email', name: 'N', body: 'b', publish: false })
    expect(p.client.query.mock.calls.some(c => String(c[0]).includes('SET current_version_id'))).toBe(false)
  })

  it('rejects a media_type change on an approved WhatsApp variant (409) and rolls back', async () => {
    const p = pool(baseRoute({ existingVariant: { id: 'v1', approval_status: 'approved', media_type: 'image' } }))
    await expect(upsertTemplate(p as any, 'ten1', { slug: 's', channel: 'whatsapp', name: 'N', body: 'b', media_type: 'video' }))
      .rejects.toMatchObject({ status: 409, code: 'media_type_locked' })
    expect(p.log.at(-1)).toBe('ROLLBACK')
    expect(p.client.release).toHaveBeenCalled()
  })
})

describe('templates-v2 writes', () => {
  it('publishVersion / archiveTemplate return whether a row changed', async () => {
    const hit = exec(() => []) ; (hit.query as any).mockResolvedValue({ rows: [], rowCount: 1 })
    expect(await publishVersion(hit as any, 'ten1', 'v1', 'ver1')).toBe(true)
    expect(await archiveTemplate(hit as any, 'ten1', 't1')).toBe(true)
    const miss = exec(() => []) ; (miss.query as any).mockResolvedValue({ rows: [], rowCount: 0 })
    expect(await publishVersion(miss as any, 'ten1', 'v1', 'ver1')).toBe(false)
    expect(await archiveTemplate(miss as any, 'ten1', 't1')).toBe(false)
  })

  it('setApprovalStatus patches the variant row', async () => {
    const e = exec(() => [])
    await setApprovalStatus(e as any, 'v1', { status: 'approved', raw: 'APPROVED', approvedAt: new Date(0) })
    expect(String(e.query.mock.calls[0][0])).toMatch(/approval_status=\$2/)
    expect(e.query.mock.calls[0][1]![1]).toBe('approved')
  })
})

describe('toApi', () => {
  it('flattens a FullTemplate and flags needs_resubmission for an edited WA template', () => {
    const now = new Date().toISOString()
    const full = {
      family: { id: 'f1', slug: 's', name: 'N', category: 'c', description: 'd', tags: ['t'] },
      template: { id: 't1', channel: 'whatsapp', status: 'active' },
      variant: { locale: 'en', provider_ref: 'HX1', meta_category: 'UTILITY', media_type: 'image', approval_status: 'approved', approval_reason: null, review_status: 'approved', review_note: null, approved_version_id: 'ver0' },
      version: { id: 'ver1', version: 2, subject: null, body: 'b', blocks: null, blocks_format: 'wa-content', variables: [], layout: 'store', created_at: now, provider_ref: null },
    }
    const api = toApi(full as any)
    expect(api).toMatchObject({ id: 't1', slug: 's', channel: 'whatsapp', needs_resubmission: true })
    expect(api.current_version?.version).toBe(2)
    // no version → current_version null, review defaults applied
    const bare = toApi({ family: { id: 'f', tags: undefined }, template: { id: 't', channel: 'email' }, variant: null, version: null } as any)
    expect(bare.current_version).toBeNull()
    expect(bare.review_status).toBe('approved')
    expect(bare.tags).toEqual([])
  })
})
