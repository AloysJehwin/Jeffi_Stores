import 'server-only'
import { createHash, randomUUID } from 'crypto'
import sharp from 'sharp'
import { query, queryOne, queryMany } from '@/lib/shared/db'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { computeBlurhash } from '@/lib/shared/s3'
import { getStorageDriver } from '@/lib/vault/storage'
import { sniffKind } from '@/lib/vault/files'
import { bumpUsage, claimUsage, getCommittedLimits } from '@/lib/vault/files'
import { classifyDriveUpload, DRIVE_MAX_FILE_BYTES, type DriveFile, type DriveKind } from './types'

// Drive bytes: checked in memory (allow-list + magic-number sniff + size/quota), images re-encoded
// (EXIF and other metadata dropped) with a thumbnail, then written to the private bucket under
// vault/drive/<tenant>/. Rows in drive_files; every read goes through a short-lived signed URL.

export class DriveError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

export interface DriveFileRow {
  id: string
  folder_id: string | null
  name: string
  mime_type: string
  kind: DriveKind
  size_bytes: string
  storage_key: string
  thumbnail_key: string | null
  width: number | null
  height: number | null
  duration_seconds: string | null
  blurhash: string | null
  sha256: string | null
  source: string
  uploaded_by_admin_id: string | null
  uploaded_by_user_id: string | null
  created_at: string
  deleted_at: string | null
  uploader_name?: string | null
}

const isText = (b: Buffer) => {
  const head = b.subarray(0, 8192)
  if (head.includes(0)) return false
  const s = head.toString('utf8').trimStart().toLowerCase()
  return !/^(<!doctype|<html|<script|<svg|<\?xml|<body|<head|<iframe)/.test(s)
}

/** Do the bytes agree with the declared kind? */
function bytesMatch(buf: Buffer, kind: DriveKind, ext: string): boolean {
  const sniffed = sniffKind(buf)
  const ascii = (a: number, b: number) => buf.subarray(a, b).toString('ascii')
  const brand = buf.length >= 12 && ascii(4, 8) === 'ftyp' ? ascii(8, 12) : ''
  switch (kind) {
    case 'image':
      if (ext === 'gif') return ascii(0, 4) === 'GIF8'
      if (ext === 'heic') return /^(heic|heix|heim|heis|hevc|mif1|msf1)$/.test(brand)
      return sniffed === 'image'
    case 'video':
      return sniffed === 'video'
    case 'audio':
      return sniffed === 'audio' || ascii(0, 4) === 'OggS' || ascii(0, 5) === '#!AMR' || (ext === 'webm' && sniffed === 'video')
    case 'pdf':
      return sniffed === 'pdf'
    case 'doc':
      if (ext === 'csv' || ext === 'txt') return isText(buf)
      return sniffed === 'other' // OOXML is a zip
    case 'other':
      return sniffed === 'other'
  }
}

const tenantPrefix = async () => `vault/drive/${(await resolveTenantId().catch(() => null)) || 'platform'}`

const ROUTE = '/api/admin/drive/files'
export function fileUrls(id: string, hasThumb: boolean) {
  return {
    url: `${ROUTE}/${id}/content`,
    thumbUrl: hasThumb ? `${ROUTE}/${id}/content?thumb=1` : null,
    downloadUrl: `${ROUTE}/${id}/content?download=1`,
  }
}

export function toDriveFile(r: DriveFileRow): DriveFile {
  return {
    id: r.id,
    folderId: r.folder_id,
    name: r.name,
    mime: r.mime_type,
    kind: r.kind,
    size: Number(r.size_bytes),
    width: r.width,
    height: r.height,
    duration: r.duration_seconds != null ? Number(r.duration_seconds) : null,
    blurhash: r.blurhash,
    source: r.source,
    createdAt: new Date(r.created_at).toISOString(),
    uploadedBy: r.uploader_name ?? null,
    ...fileUrls(r.id, !!r.thumbnail_key),
  }
}

export interface StoreInput {
  bytes: Buffer
  name: string | null
  mime: string
  folderId: string | null
  source: 'upload' | 'support' | 'whatsapp' | 'agent' | 'gallery'
  adminId?: string | null
  userId?: string | null
  /** Tighter per-call cap (e.g. customer chat uploads). */
  maxBytes?: number
}

/** Check and store one file; returns its row. Throws DriveError with an HTTP status on rejection. */
export async function storeFile(input: StoreInput): Promise<DriveFileRow> {
  const name = (input.name || `file-${Date.now()}`).replace(/[\\/\r\n\t\0]/g, '_').slice(0, 200)
  const cls = classifyDriveUpload(name, input.mime)
  if (!cls) throw new DriveError('This file type is not allowed', 415)
  const finalName = /\.[a-z0-9]+$/i.test(name) ? name : `${name}.${cls.ext}`
  let bytes = input.bytes
  if (!bytes.length) throw new DriveError('The file is empty', 400)
  const limits = await getCommittedLimits()
  const cap = Math.min(input.maxBytes ?? DRIVE_MAX_FILE_BYTES, DRIVE_MAX_FILE_BYTES, limits.maxFileBytes)
  if (bytes.length > cap) throw new DriveError(`Files can be up to ${Math.round(cap / 1024 / 1024)} MB`, 413)
  if (!bytesMatch(bytes, cls.kind, cls.ext)) throw new DriveError('The file content does not match its type', 415)

  let mime = cls.mime
  let ext = cls.ext
  let width: number | null = null
  let height: number | null = null
  let blurhash: string | null = null
  let thumb: Buffer | null = null

  if (cls.kind === 'image') {
    try {
      const animated = ext === 'gif' || (ext === 'webp' && ((await sharp(bytes, { animated: true }).metadata()).pages ?? 1) > 1)
      if (!animated) {
        // Re-encode: applies EXIF orientation and drops all metadata (GPS, device, comments).
        const img = sharp(bytes, { failOn: 'error' }).rotate()
        if (ext === 'png') bytes = await img.png().toBuffer()
        else if (ext === 'webp') bytes = await img.webp({ quality: 90 }).toBuffer()
        else {
          bytes = await img.jpeg({ quality: 90, mozjpeg: true }).toBuffer()
          if (ext === 'heic') {
            ext = 'jpg'
            mime = 'image/jpeg'
          }
        }
      }
      const meta = await sharp(bytes).metadata()
      width = meta.width ?? null
      height = meta.height ?? null
      thumb = await sharp(bytes).rotate().resize(480, 480, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 75 }).toBuffer()
      blurhash = await computeBlurhash(bytes)
    } catch {
      if (ext === 'heic') throw new DriveError('This HEIC image could not be read; please send a JPEG', 415)
      throw new DriveError('The image could not be read', 415)
    }
  }

  if (!(await claimUsage(bytes.length))) throw new DriveError('Storage quota exceeded', 413)
  const id = randomUUID()
  const prefix = await tenantPrefix()
  const key = `${prefix}/${id}.${ext}`
  const thumbKey = thumb ? `${prefix}/${id}.thumb.webp` : null
  const driver = getStorageDriver()
  try {
    await driver.put(key, bytes, mime)
    if (thumb && thumbKey) await driver.put(thumbKey, thumb, 'image/webp')
    const row = await queryOne<DriveFileRow>(
      `INSERT INTO drive_files
         (id, folder_id, name, mime_type, kind, size_bytes, storage_key, thumbnail_key, width, height, blurhash, sha256,
          source, uploaded_by_admin_id, uploaded_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING *`,
      [
        id,
        input.folderId,
        ext !== cls.ext ? finalName.replace(/\.[a-z0-9]+$/i, `.${ext}`) : finalName,
        mime,
        cls.kind,
        bytes.length,
        key,
        thumbKey,
        width,
        height,
        blurhash,
        createHash('sha256').update(bytes).digest('hex'),
        input.source,
        input.adminId ?? null,
        input.userId ?? null,
      ]
    )
    if (!row) throw new Error('drive insert failed')
    return row
  } catch (err) {
    await bumpUsage(-bytes.length, -1)
    await driver.delete(key).catch(() => {})
    if (thumbKey) await driver.delete(thumbKey).catch(() => {})
    throw err
  }
}

export async function getFileRow(id: string, opts: { withDeleted?: boolean } = {}): Promise<DriveFileRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  return queryOne<DriveFileRow>(
    `SELECT f.*, NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), '') AS uploader_name
       FROM drive_files f
       LEFT JOIN admins a ON a.id = f.uploaded_by_admin_id
       LEFT JOIN users u ON u.id = a.user_id
      WHERE f.id = $1 ${opts.withDeleted ? '' : 'AND f.deleted_at IS NULL'}`,
    [id]
  )
}

/** Inline for media/pdf/images (safe types only), attachment for everything else. */
export async function signFile(f: DriveFileRow, opts: { thumb?: boolean; download?: boolean; ttlSeconds?: number } = {}): Promise<string> {
  const driver = getStorageDriver()
  const key = opts.thumb && f.thumbnail_key ? f.thumbnail_key : f.storage_key
  const inlineOk = ['image', 'video', 'audio', 'pdf'].includes(f.kind) && !opts.download
  return driver.signDownload(key, {
    disposition: inlineOk ? 'inline' : 'attachment',
    filename: opts.thumb ? `${f.id}.webp` : f.name,
    contentType: opts.thumb && f.thumbnail_key ? 'image/webp' : inlineOk ? f.mime_type : 'application/octet-stream',
    ttlSeconds: opts.ttlSeconds ?? 300,
  })
}

/** Where a file sits in S3 (null under the local driver), for services that read it directly. */
export function s3Location(f: DriveFileRow): { bucket: string; key: string } | null {
  const b = getStorageDriver().bucket
  return b ? { bucket: b, key: f.storage_key } : null
}

export async function readFileBytes(f: DriveFileRow): Promise<Buffer> {
  return getStorageDriver().get(f.storage_key)
}

export async function logDriveAccess(p: {
  fileId?: string | null
  folderId?: string | null
  adminId?: string | null
  userId?: string | null
  action: 'view' | 'download' | 'upload' | 'delete' | 'restore' | 'share' | 'move' | 'rename' | 'purge'
  ip?: string | null
  userAgent?: string | null
}): Promise<void> {
  // Keep a network, not a full address: /24 for IPv4, /48 for IPv6.
  const ip = p.ip?.split(',')[0].trim() || null
  const net = ip
    ? ip.includes(':')
      ? `${ip.split(':').slice(0, 3).join(':')}::/48`
      : `${ip.split('.').slice(0, 3).join('.')}.0/24`
    : null
  await query(
    `INSERT INTO drive_access_log (file_id, folder_id, admin_id, user_id, action, ip_net, user_agent) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [p.fileId ?? null, p.folderId ?? null, p.adminId ?? null, p.userId ?? null, p.action, net, p.userAgent?.slice(0, 300) ?? null]
  ).catch(() => {})
}

/** Trash → gone after 30 days: objects deleted, usage released. */
export async function purgeTrash(days = 30): Promise<number> {
  const rows = await queryMany<DriveFileRow>(
    `SELECT * FROM drive_files df WHERE deleted_at IS NOT NULL AND deleted_at < now() - ($1 || ' days')::interval
        AND NOT EXISTS (SELECT 1 FROM support_message_attachments a WHERE a.drive_file_id = df.id) LIMIT 500`,
    [String(days)]
  )
  const driver = getStorageDriver()
  // Files still attached to a support message stay (the chat must keep showing them).
  for (const r of rows) {
    await driver.delete(r.storage_key).catch(() => {})
    if (r.thumbnail_key) await driver.delete(r.thumbnail_key).catch(() => {})
    await query(`DELETE FROM drive_files WHERE id = $1`, [r.id])
    await bumpUsage(-Number(r.size_bytes), -1)
    await logDriveAccess({ fileId: r.id, action: 'purge' })
  }
  return rows.length
}
