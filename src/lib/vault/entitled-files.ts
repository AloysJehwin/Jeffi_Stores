import 'server-only'
import { queryOne, queryMany } from '@/lib/shared/db'
import { getFeatureFlags } from '@/lib/catalog/site-controls'
import { effectiveDownloadable } from '@/lib/catalog/digital'

// Entitlement-scoped reads for the vault viewer + stream route. "Owned" means: an active, not-
// revoked, not-expired vault_entitlement for this user on the product that holds the file.

export interface OwnedFile {
  id: string
  product_id: string
  kind: 'video' | 'audio' | 'pdf' | 'image' | 'other'
  status: string
  downloadable: boolean
  storage_key: string
  display_name: string
  original_name: string | null
  mime_type: string
  size_bytes: number
  page_count: number | null
  duration_seconds: number | null
  display_order: number
}

export interface EntitledProduct {
  product_id: string
  title: string
  cover_url: string | null
  source: string
  granted_at: string
  access_expires_at: string | null
  /** Distinct kinds of the product's ready files (drives the library type filter). */
  kinds: string[]
  file_count: number
  category: string | null
  brand: string | null
}

export interface EntitlementSummary {
  id: string
  title: string
  source: string
  access_expires_at: string | null
  order_number: string | null
}

const ACTIVE = `status = 'active' AND (access_expires_at IS NULL OR access_expires_at > NOW())`

/** The session user's active entitlements, newest first, with a cover image + title. */
export async function listEntitlements(userId: string): Promise<EntitledProduct[]> {
  return queryMany<EntitledProduct>(
    `
    SELECT DISTINCT ON (e.product_id)
      e.product_id, p.name AS title, e.source, e.granted_at, e.access_expires_at,
      (SELECT pi.image_url FROM product_images pi
        WHERE pi.product_id = e.product_id ORDER BY pi.display_order, pi.id LIMIT 1) AS cover_url,
      f.kinds, f.file_count, c.name AS category, b.name AS brand
    FROM vault_entitlements e
    JOIN products p ON p.id = e.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN brands b ON b.id = p.brand_id
    CROSS JOIN LATERAL (
      SELECT COALESCE(array_agg(DISTINCT pf.kind), '{}') AS kinds, COUNT(*)::int AS file_count
        FROM product_files pf WHERE pf.product_id = e.product_id AND pf.status = 'ready'
    ) f
    WHERE e.user_id = $1 AND e.${ACTIVE}
    ORDER BY e.product_id, e.granted_at DESC
    `,
    [userId]
  )
}

/** The newest active entitlement for a product (item page meta + watermark reference). */
export async function entitlementSummary(userId: string, productId: string): Promise<EntitlementSummary | null> {
  return queryOne<EntitlementSummary>(
    `SELECT e.id, p.name AS title, e.source, e.access_expires_at, o.order_number
       FROM vault_entitlements e
       JOIN products p ON p.id = e.product_id
       LEFT JOIN orders o ON o.id = e.order_id
      WHERE e.user_id = $1 AND e.product_id = $2 AND e.status = 'active'
        AND (e.access_expires_at IS NULL OR e.access_expires_at > NOW())
      ORDER BY e.granted_at DESC LIMIT 1`,
    [userId, productId]
  )
}

/** True when the user holds an active entitlement for the product. */
export async function hasEntitlement(userId: string, productId: string): Promise<boolean> {
  const row = await queryOne<{ ok: boolean }>(
    `SELECT TRUE AS ok FROM vault_entitlements WHERE user_id = $1 AND product_id = $2 AND ${ACTIVE} LIMIT 1`,
    [userId, productId]
  )
  return !!row
}

/** Ready files for a product the user owns, viewer-ordered. Empty when not entitled. */
export async function ownedFilesForProduct(userId: string, productId: string): Promise<OwnedFile[]> {
  if (!(await hasEntitlement(userId, productId))) return []
  return queryMany<OwnedFile>(
    `SELECT id, product_id, kind, status, downloadable, storage_key, display_name, original_name,
            mime_type, size_bytes, page_count, duration_seconds, display_order
       FROM product_files
      WHERE product_id = $1 AND status = 'ready'
      ORDER BY display_order, created_at`,
    [productId]
  )
}

/** Buyer identity for the watermark overlay (email, else masked phone). */
export async function buyerLabel(userId: string): Promise<string> {
  const row = await queryOne<{ email: string | null; phone: string | null }>(
    `SELECT email, phone FROM users WHERE id = $1`,
    [userId]
  )
  if (row?.email) return row.email
  if (row?.phone) return row.phone
  return userId.slice(0, 8)
}

/** A single owned, ready file by id — the stream route's entitlement gate. NULL = not owned. */
export async function ownedFileById(userId: string, fileId: string): Promise<OwnedFile | null> {
  const file = await queryOne<OwnedFile>(
    `SELECT id, product_id, kind, status, downloadable, storage_key, display_name, original_name,
            mime_type, size_bytes, page_count, duration_seconds, display_order
       FROM product_files WHERE id = $1 AND status = 'ready'`,
    [fileId]
  )
  if (!file) return null
  if (!(await hasEntitlement(userId, file.product_id))) return null
  return file
}

/**
 * Effective download = store master `vaultDownloadsEnabled` AND the file's own `downloadable`.
 * A stream (inline) URL must never double as a download, so the stream route uses this to decide
 * disposition and the viewer uses it to decide whether to render a download button at all.
 */
export async function fileDownloadAllowed(file: OwnedFile): Promise<boolean> {
  const { vaultDownloadsEnabled } = await getFeatureFlags()
  return effectiveDownloadable(vaultDownloadsEnabled, file.downloadable)
}

const RASTER_IMAGE = /^image\/(png|jpe?g|webp|gif|avif)$/i

/** Never let an uploaded HTML/SVG/script render inline; pin a safe type per kind. */
export function safeContentType(kind: OwnedFile['kind'], mime: string): string {
  const m = (mime || '').toLowerCase()
  if (kind === 'pdf') return 'application/pdf'
  if (kind === 'video' && m.startsWith('video/')) return m
  if (kind === 'audio' && m.startsWith('audio/')) return m
  if (kind === 'image' && RASTER_IMAGE.test(m)) return m
  return 'application/octet-stream'
}
