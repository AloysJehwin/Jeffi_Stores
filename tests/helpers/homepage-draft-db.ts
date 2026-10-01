type Row = Record<string, any> & { id: string }
type Table = 'sections' | 'hero_slides'

interface Draft {
  sections: Row[]
  hero_slides: Row[]
  updated_by: string | null
  updated_at: string
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const tableOf = (name: string): Table => (name === 'homepage_sections' ? 'sections' : 'hero_slides')
const ordered = (rows: Row[]) =>
  [...rows].sort((a, b) => a.display_order - b.display_order || Date.parse(a.created_at) - Date.parse(b.created_at))

/**
 * In-memory stand-in for the homepage_drafts / homepage_sections / hero_slides SQL issued by
 * src/lib/homepage-draft.ts. Any other statement throws, so a route that still writes a live
 * table directly fails its test. A throwing transaction restores the state (rollback).
 */
export function makeHomepageDraftDb() {
  const state = {
    live: { sections: [] as Row[], hero_slides: [] as Row[] },
    draft: null as Draft | null,
    adminNames: {} as Record<string, string>,
    statements: [] as string[],
    rollbacks: 0,
  }

  function run(sql: string, params: any[] = []) {
    state.statements.push(sql)
    if (sql.startsWith('INSERT INTO homepage_drafts')) {
      if (state.draft) return { rows: [], rowCount: 0 }
      state.draft = { ...clone(state.live), updated_by: params[0] ?? null, updated_at: new Date().toISOString() }
      return { rows: [], rowCount: 1 }
    }
    if (sql.startsWith('SELECT sections, hero_slides FROM homepage_drafts') && sql.includes('FOR UPDATE')) {
      const rows = state.draft
        ? [{ sections: clone(state.draft.sections), hero_slides: clone(state.draft.hero_slides) }]
        : []
      return { rows, rowCount: rows.length }
    }
    if (sql.startsWith('UPDATE homepage_drafts')) {
      state.draft = {
        sections: JSON.parse(params[0]),
        hero_slides: JSON.parse(params[1]),
        updated_by: params[2],
        updated_at: new Date().toISOString(),
      }
      return { rows: [], rowCount: 1 }
    }
    if (sql.startsWith('DELETE FROM homepage_drafts')) {
      const had = state.draft !== null
      state.draft = null
      return { rows: [], rowCount: had ? 1 : 0 }
    }
    const upsert = sql.match(/^INSERT INTO (homepage_sections|hero_slides) AS t/)
    if (upsert) {
      const table = tableOf(upsert[1])
      const out: { inserted: boolean }[] = []
      for (const row of JSON.parse(params[0]) as Row[]) {
        const i = state.live[table].findIndex(r => r.id === row.id)
        if (i === -1) {
          state.live[table].push(row)
          out.push({ inserted: true })
        } else if (JSON.stringify(state.live[table][i]) !== JSON.stringify(row)) {
          state.live[table][i] = row
          out.push({ inserted: false })
        }
      }
      return { rows: out, rowCount: out.length }
    }
    const prune = sql.match(/^DELETE FROM (homepage_sections|hero_slides) WHERE NOT/)
    if (prune) {
      const table = tableOf(prune[1])
      const keep = new Set<string>(params[0])
      const before = state.live[table].length
      state.live[table] = state.live[table].filter(r => keep.has(r.id))
      return { rows: [], rowCount: before - state.live[table].length }
    }
    throw new Error(`unexpected SQL: ${sql.slice(0, 80)}`)
  }

  function queryOne(sql: string) {
    state.statements.push(sql)
    if (sql.includes('FROM homepage_drafts d')) {
      const d = state.draft
      if (!d) return null
      return {
        sections: clone(d.sections),
        hero_slides: clone(d.hero_slides),
        updated_at: new Date(d.updated_at),
        updated_by_name: d.updated_by ? (state.adminNames[d.updated_by] ?? null) : null,
      }
    }
    if (sql.startsWith('SELECT COALESCE((SELECT jsonb_agg')) {
      return { sections: ordered(clone(state.live.sections)), hero_slides: ordered(clone(state.live.hero_slides)) }
    }
    throw new Error(`unexpected SQL: ${sql.slice(0, 80)}`)
  }

  async function withTransaction<T>(fn: (client: { query: typeof run }) => Promise<T>): Promise<T> {
    const snapshot = clone({ live: state.live, draft: state.draft })
    try {
      return await fn({ query: async (sql: string, params?: any[]) => run(sql, params) } as any)
    } catch (err) {
      state.live = snapshot.live
      state.draft = snapshot.draft
      state.rollbacks++
      throw err
    }
  }

  function reset(live: { sections?: Row[]; heroSlides?: Row[] } = {}) {
    state.live = { sections: clone(live.sections ?? []), hero_slides: clone(live.heroSlides ?? []) }
    state.draft = null
    state.adminNames = {}
    state.statements = []
    state.rollbacks = 0
  }

  const db = {
    query: async (sql: string, params?: any[]) => run(sql, params),
    queryOne: async (sql: string) => queryOne(sql),
    queryMany: async (sql: string) => {
      throw new Error(`unexpected SQL: ${sql.slice(0, 80)}`)
    },
    withTransaction,
  }

  return { state, db, reset }
}

export function sectionRow(id: string, display_order: number, extra: Record<string, unknown> = {}): Row {
  return {
    id,
    type: 'promo_banner',
    title: `Section ${id}`,
    subtitle: null,
    eyebrow: null,
    cta_label: null,
    cta_url: null,
    config: {},
    display_order,
    is_active: true,
    starts_at: null,
    ends_at: null,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    ...extra,
  }
}

export function slideRow(id: string, display_order: number, extra: Record<string, unknown> = {}): Row {
  return {
    id,
    title: `Slide ${id}`,
    subtitle: null,
    badge_text: null,
    badge_color: 'bg-primary-500',
    image_url: null,
    image_url_mobile: null,
    blurhash: null,
    blurhash_mobile: null,
    cta_label: null,
    cta_url: null,
    filter_category: null,
    filter_brand: null,
    filter_grade: null,
    filter_material: null,
    filter_min_price: null,
    filter_max_price: null,
    filter_in_stock: false,
    filter_on_sale: false,
    display_order,
    is_active: true,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    ...extra,
  }
}
