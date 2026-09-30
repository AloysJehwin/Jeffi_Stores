import sharp from 'sharp'
import { query, queryMany, queryOne } from './db'
import { getS3Url, putObjectBuffer, deleteObjectKey } from './s3'
import { logActivity } from './activity'
import { isPlatformOwner } from './scopes'

import {
  NOTE_TAGS,
  type NoteTag,
  type NoteSource,
  type NoteAttachment,
  type CustomerNote,
} from './customer-notes-shared'
export { NOTE_TAGS }
export type { NoteTag, NoteSource, NoteAttachment, CustomerNote }

export const MAX_ATTACHMENTS = 8
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_AUDIO_BYTES = 15 * 1024 * 1024
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
const AUDIO_TYPES = new Set([
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/x-m4a',
  'audio/aac',
  'audio/mp4;codecs=opus',
  'audio/webm;codecs=opus',
])

interface NoteRow {
  id: string
  user_id: string
  body: string
  title: string | null
  tags: string[] | null
  order_id: string | null
  order_number: string | null
  return_request_id: string | null
  shared_with_customer: boolean
  source: NoteSource
  created_at: string
  admin_id: string | null
  admin_username: string | null
  attachments: any[] | null
}

const NOTE_SELECT = `
  SELECT n.id, n.user_id, n.body, n.title, n.tags, n.order_id, o.order_number, n.return_request_id,
         n.shared_with_customer, n.source, n.created_at, n.admin_id,
         COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), u.email) AS admin_username,
         COALESCE((SELECT json_agg(att ORDER BY att.display_order, att.created_at)
                   FROM customer_note_attachments att WHERE att.note_id = n.id), '[]'::json) AS attachments
  FROM customer_notes n
  LEFT JOIN orders o ON o.id = n.order_id
  LEFT JOIN admins a ON n.admin_id = a.id
  LEFT JOIN users u ON a.user_id = u.id`

async function mapAttachment(a: any): Promise<NoteAttachment> {
  return {
    id: a.id,
    kind: a.kind,
    url: await getS3Url(a.s3_key),
    thumbnailUrl: a.s3_thumbnail_key ? await getS3Url(a.s3_thumbnail_key) : null,
    mimeType: a.mime_type,
    sizeBytes: Number(a.size_bytes) || 0,
    width: a.width ?? null,
    height: a.height ?? null,
    durationSeconds: a.duration_seconds ?? null,
    originalName: a.original_name ?? null,
  }
}

async function mapNote(r: NoteRow): Promise<CustomerNote> {
  return {
    id: r.id,
    userId: r.user_id,
    body: r.body,
    title: r.title,
    tags: Array.isArray(r.tags) ? r.tags : [],
    orderId: r.order_id,
    orderNumber: r.order_number,
    returnRequestId: r.return_request_id,
    sharedWithCustomer: !!r.shared_with_customer,
    source: r.source,
    createdAt: r.created_at,
    adminId: r.admin_id,
    adminUsername: r.admin_username,
    attachments: await Promise.all((r.attachments || []).map(mapAttachment)),
  }
}

export async function listNotes(opts: {
  userId: string
  orderId?: string | null
  returnRequestId?: string | null
  sharedOnly?: boolean
  limit?: number
}): Promise<CustomerNote[]> {
  const wheres = ['n.user_id = $1']
  const vals: any[] = [opts.userId]
  if (opts.orderId) {
    vals.push(opts.orderId)
    wheres.push(`n.order_id = $${vals.length}`)
  }
  if (opts.returnRequestId) {
    vals.push(opts.returnRequestId)
    wheres.push(`n.return_request_id = $${vals.length}`)
  }
  if (opts.sharedOnly) wheres.push('n.shared_with_customer = true')
  vals.push(Math.min(200, Math.max(1, opts.limit ?? 100)))
  const rows = await queryMany<NoteRow>(
    `${NOTE_SELECT} WHERE ${wheres.join(' AND ')} ORDER BY n.created_at DESC LIMIT $${vals.length}`,
    vals
  )
  return Promise.all(rows.map(mapNote))
}

/** Notes the store chose to share with the customer, for their own order page. */
export async function listSharedNotesForOrder(userId: string, orderId: string): Promise<CustomerNote[]> {
  const rows = await queryMany<NoteRow>(
    `${NOTE_SELECT} WHERE n.user_id = $1 AND n.shared_with_customer = true AND (n.order_id = $2 OR n.order_id IS NULL)
     ORDER BY n.created_at DESC LIMIT 50`,
    [userId, orderId]
  )
  return Promise.all(rows.map(mapNote))
}

export async function getNote(noteId: string): Promise<CustomerNote | null> {
  const row = await queryOne<NoteRow>(`${NOTE_SELECT} WHERE n.id = $1`, [noteId])
  return row ? mapNote(row) : null
}

export function sanitizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const allowed = new Set<string>(NOTE_TAGS)
  return [...new Set(input.map(t => String(t).trim().toLowerCase()).filter(t => allowed.has(t)))]
}

export async function createNote(input: {
  userId: string
  adminId: string | null
  body: string
  title?: string | null
  tags?: string[]
  orderId?: string | null
  returnRequestId?: string | null
  sharedWithCustomer?: boolean
  source: NoteSource
}): Promise<{ id: string | null } | { error: string }> {
  const body = String(input.body || '')
    .trim()
    .slice(0, 2000)
  const title = input.title ? String(input.title).trim().slice(0, 200) : null
  if (input.orderId) {
    const own = await queryOne(`SELECT 1 FROM orders WHERE id = $1 AND user_id = $2`, [input.orderId, input.userId])
    if (!own) return { error: 'Order does not belong to this customer' }
  }
  if (input.returnRequestId) {
    const own = await queryOne(
      `SELECT 1 FROM return_requests r JOIN orders o ON o.id = r.order_id WHERE r.id = $1 AND o.user_id = $2`,
      [input.returnRequestId, input.userId]
    )
    if (!own) return { error: 'Return request does not belong to this customer' }
  }
  const res = await query<{ id: string }>(
    `INSERT INTO customer_notes (user_id, admin_id, body, title, tags, order_id, return_request_id, shared_with_customer, source)
     VALUES ($1, $2, $3, $4, $5::text[], $6, $7, $8, $9) RETURNING id`,
    [
      input.userId,
      input.adminId,
      body,
      title,
      sanitizeTags(input.tags),
      input.orderId ?? null,
      input.returnRequestId ?? null,
      !!input.sharedWithCustomer,
      input.source,
    ]
  )
  const noteId: string | null = res?.rows?.[0]?.id ?? null
  const summary = title || body
  await logActivity({
    userId: input.userId,
    actorId: input.adminId,
    kind: 'note_added',
    referenceId: noteId,
    referenceType: 'customer_note',
    summary: summary.length > 120 ? summary.slice(0, 120) + '…' : summary || 'Note with attachments',
    metadata: {
      source: input.source,
      orderId: input.orderId ?? null,
      tags: sanitizeTags(input.tags),
      shared: !!input.sharedWithCustomer,
    },
  })
  return { id: noteId }
}

function attachmentKind(mime: string): 'image' | 'audio' | null {
  const m = mime.toLowerCase()
  if (IMAGE_TYPES.has(m)) return 'image'
  if (AUDIO_TYPES.has(m) || m.startsWith('audio/')) return 'audio'
  return null
}

function safeExt(mime: string): string {
  const m = mime.toLowerCase().split(';')[0]
  if (m === 'audio/webm') return 'webm'
  if (m === 'audio/ogg') return 'ogg'
  if (m === 'audio/mp4' || m === 'audio/x-m4a' || m === 'audio/aac') return 'm4a'
  if (m === 'audio/mpeg') return 'mp3'
  if (m === 'audio/wav') return 'wav'
  return 'bin'
}

export async function addAttachment(
  noteId: string,
  file: File,
  opts?: { durationSeconds?: number | null; displayOrder?: number }
): Promise<NoteAttachment | { error: string }> {
  const kind = attachmentKind(file.type || '')
  if (!kind) return { error: `Unsupported file type: ${file.type || 'unknown'}` }
  if (kind === 'image' && file.size > MAX_IMAGE_BYTES) return { error: 'Image exceeds 10MB' }
  if (kind === 'audio' && file.size > MAX_AUDIO_BYTES) return { error: 'Audio exceeds 15MB' }
  const count = await queryOne<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM customer_note_attachments WHERE note_id = $1`,
    [noteId]
  )
  if (parseInt(count?.n || '0', 10) >= MAX_ATTACHMENTS)
    return { error: `Maximum ${MAX_ATTACHMENTS} attachments per note` }

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const buffer = Buffer.from(await file.arrayBuffer())
  let s3Key: string,
    thumbKey: string | null = null,
    mime: string,
    size: number,
    width: number | null = null,
    height: number | null = null

  if (kind === 'image') {
    // Re-encode strips EXIF (incl. GPS) and normalizes orientation before the file is stored.
    const main = await sharp(buffer)
      .rotate()
      .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer({ resolveWithObject: true })
    const thumb = await sharp(buffer).rotate().resize(400, 400, { fit: 'cover' }).jpeg({ quality: 80 }).toBuffer()
    s3Key = `customer-notes/${noteId}/${stamp}.jpg`
    thumbKey = `customer-notes/${noteId}/thumbnails/${stamp}.jpg`
    await putObjectBuffer(s3Key, main.data, 'image/jpeg')
    await putObjectBuffer(thumbKey, thumb, 'image/jpeg')
    mime = 'image/jpeg'
    size = main.data.length
    width = main.info.width
    height = main.info.height
  } else {
    mime = (file.type || 'audio/webm').split(';')[0]
    s3Key = `customer-notes/${noteId}/${stamp}.${safeExt(mime)}`
    await putObjectBuffer(s3Key, buffer, mime)
    size = buffer.length
  }

  const row = await queryOne<any>(
    `INSERT INTO customer_note_attachments (note_id, kind, s3_key, s3_thumbnail_key, mime_type, size_bytes, width, height, duration_seconds, original_name, display_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [
      noteId,
      kind,
      s3Key,
      thumbKey,
      mime,
      size,
      width,
      height,
      opts?.durationSeconds ?? null,
      (file.name || '').slice(0, 255) || null,
      opts?.displayOrder ?? 0,
    ]
  )
  return mapAttachment(row)
}

export async function deleteNote(noteId: string, userId: string): Promise<boolean> {
  const atts =
    (await queryMany<{ s3_key: string; s3_thumbnail_key: string | null }>(
      `SELECT att.s3_key, att.s3_thumbnail_key FROM customer_note_attachments att
     JOIN customer_notes n ON n.id = att.note_id WHERE n.id = $1 AND n.user_id = $2`,
      [noteId, userId]
    )) || []
  const res = await query(`DELETE FROM customer_notes WHERE id = $1 AND user_id = $2`, [noteId, userId])
  if ((res.rowCount ?? 0) === 0) return false
  for (const a of atts) {
    await deleteObjectKey(a.s3_key).catch(() => {})
    if (a.s3_thumbnail_key) await deleteObjectKey(a.s3_thumbnail_key).catch(() => {})
  }
  return true
}

export async function setNoteShared(noteId: string, userId: string, shared: boolean): Promise<boolean> {
  const res = await query(
    `UPDATE customer_notes SET shared_with_customer = $3, updated_at = NOW() WHERE id = $1 AND user_id = $2`,
    [noteId, userId, shared]
  )
  return (res.rowCount ?? 0) > 0
}

export interface CustomerHit {
  id: string
  name: string
  email: string | null
  phone: string | null
  lastOrderNumber: string | null
}

/** Name / email / phone / order-number lookup for the staff capture form. */
export async function searchCustomers(q: string, limit = 8): Promise<CustomerHit[]> {
  const term = q.trim()
  if (term.length < 2) return []
  const like = `%${term}%`
  const rows = await queryMany<any>(
    `SELECT DISTINCT ON (u.id) u.id, u.first_name, u.last_name, u.email, u.phone,
            (SELECT o2.order_number FROM orders o2 WHERE o2.user_id = u.id ORDER BY o2.created_at DESC LIMIT 1) AS last_order_number
     FROM users u
     LEFT JOIN orders o ON o.user_id = u.id
     WHERE u.is_guest = false AND (
       (u.first_name || ' ' || COALESCE(u.last_name, '')) ILIKE $1 OR u.email ILIKE $1 OR u.phone ILIKE $1 OR o.order_number ILIKE $1
     )
     ORDER BY u.id LIMIT $2`,
    [like, limit]
  )
  return rows.map(r => ({
    id: r.id,
    name: [r.first_name, r.last_name].filter(Boolean).join(' ') || r.email || 'Customer',
    email: r.email ?? null,
    phone: r.phone ?? null,
    lastOrderNumber: r.last_order_number ?? null,
  }))
}

export interface OrderHit {
  id: string
  orderNumber: string
  status: string
  createdAt: string
  total: number
  returnRequestId: string | null
}

export async function searchOrdersForCustomer(userId: string, q?: string, limit = 10): Promise<OrderHit[]> {
  const vals: any[] = [userId]
  let where = 'o.user_id = $1'
  if (q && q.trim()) {
    vals.push(`%${q.trim()}%`)
    where += ` AND o.order_number ILIKE $${vals.length}`
  }
  vals.push(limit)
  const rows = await queryMany<any>(
    `SELECT o.id, o.order_number, o.status, o.created_at, o.total_amount,
            (SELECT r.id FROM return_requests r WHERE r.order_id = o.id ORDER BY r.created_at DESC LIMIT 1) AS return_request_id
     FROM orders o WHERE ${where} ORDER BY o.created_at DESC LIMIT $${vals.length}`,
    vals
  )
  return rows.map(r => ({
    id: r.id,
    orderNumber: r.order_number,
    status: r.status,
    createdAt: r.created_at,
    total: Number(r.total_amount) || 0,
    returnRequestId: r.return_request_id ?? null,
  }))
}

/** Owner / administrator emails (active), excluding one address. */
export async function ownerAdminEmails(excludeEmail?: string | null): Promise<{ email: string; name: string }[]> {
  const rows = await queryMany<{ email: string; first_name: string | null; role: string }>(
    `SELECT u.email, u.first_name, a.role FROM admins a JOIN users u ON u.id = a.user_id
     WHERE a.is_active = true AND u.is_active = true AND u.email IS NOT NULL`
  )
  return rows
    .filter(r => isPlatformOwner(r.role) && r.email.toLowerCase() !== (excludeEmail || '').toLowerCase())
    .map(r => ({ email: r.email, name: r.first_name || 'there' }))
}

export async function listNotesSince(
  sinceIso: string,
  limit = 200
): Promise<(CustomerNote & { customerName: string })[]> {
  const rows = await queryMany<NoteRow & { customer_name: string }>(
    `${NOTE_SELECT.replace('FROM customer_notes n', ", COALESCE(NULLIF(TRIM(cu.first_name || ' ' || cu.last_name), ''), cu.email) AS customer_name FROM customer_notes n JOIN users cu ON cu.id = n.user_id")}
     WHERE n.created_at >= $1 ORDER BY n.created_at DESC LIMIT $2`,
    [sinceIso, limit]
  )
  return Promise.all(rows.map(async r => ({ ...(await mapNote(r)), customerName: r.customer_name })))
}
