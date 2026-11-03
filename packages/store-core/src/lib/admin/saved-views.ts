import 'server-only'
import { normalizeQuery, type FilterEntity } from '@jeffi/list-filters'
import { queryMany, queryOne } from '@/lib/shared/db'

// Named filter sets on an admin list, per admin, optionally shared with everyone who can read it.

export const MAX_VIEWS_PER_PAGE = 50
export const MAX_QUERY_LENGTH = 4000

export interface SavedView {
  id: string
  name: string
  query: string
  isShared: boolean
  mine: boolean
  ownerName: string | null
  updatedAt: string
}

interface Row {
  id: string
  page_key: string
  name: string
  query: string
  is_shared: boolean
  mine: boolean
  owner_name: string | null
  updated_at: Date | string
}

const toView = (r: Row): SavedView => ({
  id: r.id,
  name: r.name,
  query: r.query,
  isShared: r.is_shared,
  mine: r.mine,
  ownerName: r.owner_name,
  updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
})

const COLS = 'v.id, v.page_key, v.name, v.query, v.is_shared, v.updated_at'

export const writeScopeOf = (e: FilterEntity) => e.writeScope ?? e.scope.replace(/:read$/, ':write')

/** What a view stores: the entity's own filters (aliases applied, values validated) and sort; never tab or page. */
export function viewQuery(entity: FilterEntity, raw: string): string {
  const sp = new URLSearchParams(raw)
  const out = new URLSearchParams(normalizeQuery(entity, sp))
  const sort = sp.get('sort')
  if (sort && entity.sorts && Object.hasOwn(entity.sorts, sort)) {
    out.set('sort', sort)
    const dir = sp.get('dir')
    if (dir === 'asc' || dir === 'desc') out.set('dir', dir)
  }
  return out.toString()
}

/** The admin's own views on a list, then the ones others share, with the owner's name. */
export async function listSavedViews(adminId: string, pageKey: string): Promise<SavedView[]> {
  const rows = await queryMany<Row>(
    `SELECT ${COLS}, v.admin_id = $1::uuid AS mine,
            COALESCE(NULLIF(btrim(concat_ws(' ', u.first_name, u.last_name)), ''), u.email) AS owner_name
       FROM admin_saved_views v
       LEFT JOIN admins a ON a.id = v.admin_id
       LEFT JOIN users u ON u.id = a.user_id
      WHERE v.page_key = $2 AND (v.admin_id = $1::uuid OR v.is_shared)
      ORDER BY (v.admin_id = $1::uuid) DESC, lower(v.name)
      LIMIT 200`,
    [adminId, pageKey]
  )
  return rows.map(toView)
}

/** The admin's own view (any list), or null: updates and deletes only ever touch these. */
export async function getOwnView(adminId: string, id: string): Promise<(SavedView & { pageKey: string }) | null> {
  const r = await queryOne<Row>(
    `SELECT ${COLS}, true AS mine, NULL AS owner_name FROM admin_saved_views v WHERE v.id = $1 AND v.admin_id = $2::uuid`,
    [id, adminId]
  )
  return r ? { ...toView(r), pageKey: r.page_key } : null
}

/** 'limit' at MAX_VIEWS_PER_PAGE views on the list, 'duplicate' when the name is taken. */
export async function createSavedView(
  adminId: string,
  pageKey: string,
  v: { name: string; query: string; isShared: boolean }
): Promise<SavedView | 'limit' | 'duplicate'> {
  try {
    const r = await queryOne<Row>(
      `INSERT INTO admin_saved_views AS v (admin_id, page_key, name, query, is_shared)
       SELECT $1::uuid, $2::varchar, $3, $4, $5
        WHERE (SELECT count(*) FROM admin_saved_views WHERE admin_id = $1::uuid AND page_key = $2::varchar) < ${MAX_VIEWS_PER_PAGE}
       RETURNING ${COLS}, true AS mine, NULL AS owner_name`,
      [adminId, pageKey, v.name, v.query, v.isShared]
    )
    return r ? toView(r) : 'limit'
  } catch (err) {
    if ((err as { code?: string }).code === '23505') return 'duplicate'
    throw err
  }
}

export async function updateSavedView(
  adminId: string,
  id: string,
  patch: { name?: string; query?: string; isShared?: boolean }
): Promise<SavedView | null | 'duplicate'> {
  try {
    const r = await queryOne<Row>(
      `UPDATE admin_saved_views AS v
          SET name = COALESCE($3, v.name), query = COALESCE($4, v.query),
              is_shared = COALESCE($5, v.is_shared), updated_at = now()
        WHERE v.id = $1 AND v.admin_id = $2::uuid
        RETURNING ${COLS}, true AS mine, NULL AS owner_name`,
      [id, adminId, patch.name ?? null, patch.query ?? null, patch.isShared ?? null]
    )
    return r ? toView(r) : null
  } catch (err) {
    if ((err as { code?: string }).code === '23505') return 'duplicate'
    throw err
  }
}

export async function deleteSavedView(adminId: string, id: string): Promise<boolean> {
  const r = await queryOne<{ id: string }>(
    'DELETE FROM admin_saved_views WHERE id = $1 AND admin_id = $2::uuid RETURNING id',
    [id, adminId]
  )
  return !!r
}
