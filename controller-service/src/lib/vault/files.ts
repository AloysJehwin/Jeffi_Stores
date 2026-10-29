import 'server-only'
import { randomUUID } from 'crypto'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { queryOne, queryMany, withTransaction } from '@/lib/shared/db'
import { controlPlanePool } from '@/lib/tenant-registry/shared'
import { getStorageDriver, vaultKey, vaultStagingKey, type StorageDriver } from './storage'
import type { PoolClient } from 'pg'

// Admin vault-file uploads: plan quota (control plane), MIME/ext allow-list, magic-number sniff on
// complete, product_files ledger + tenant_infra usage. Quota is checked on declared bytes before the
// upload URL is issued, then reconciled against the real object size on complete.

export type FileKind = 'video' | 'audio' | 'pdf' | 'image' | 'other'

export interface PlanLimits {
  storageQuotaBytes: number
  maxFileBytes: number
  usedStorageBytes: number
  fileCount: number
}

// (ext, mime-prefix/exact, kind). An upload must match one row by extension; the declared mime
// must share the row's kind, and the sniff (completeUpload) must agree. Never allow html/svg/js.
const ALLOW: Array<{ ext: string; mimes: string[]; kind: FileKind }> = [
  { ext: 'mp4', mimes: ['video/mp4'], kind: 'video' },
  { ext: 'webm', mimes: ['video/webm'], kind: 'video' },
  { ext: 'mov', mimes: ['video/quicktime'], kind: 'video' },
  { ext: 'mp3', mimes: ['audio/mpeg'], kind: 'audio' },
  { ext: 'm4a', mimes: ['audio/mp4', 'audio/x-m4a'], kind: 'audio' },
  { ext: 'wav', mimes: ['audio/wav', 'audio/x-wav'], kind: 'audio' },
  { ext: 'pdf', mimes: ['application/pdf'], kind: 'pdf' },
  { ext: 'png', mimes: ['image/png'], kind: 'image' },
  { ext: 'jpg', mimes: ['image/jpeg'], kind: 'image' },
  { ext: 'jpeg', mimes: ['image/jpeg'], kind: 'image' },
  { ext: 'webp', mimes: ['image/webp'], kind: 'image' },
  { ext: 'zip', mimes: ['application/zip'], kind: 'other' },
  { ext: 'epub', mimes: ['application/epub+zip'], kind: 'other' },
]

export function extensionOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name.trim())
  return m ? m[1].toLowerCase() : ''
}

/** Allow-list row for a declared (name, mime); null when disallowed. A blank/octet-stream mime
 * (browsers often omit it for m4a/epub) takes the extension's canonical mime. */
export function classifyUpload(
  name: string,
  mime: string
): { ext: string; kind: FileKind; mime: string } | null {
  const ext = extensionOf(name)
  const row = ALLOW.find(a => a.ext === ext)
  if (!row) return null
  const m = mime.trim().toLowerCase()
  if (!m || m === 'application/octet-stream') return { ext, kind: row.kind, mime: row.mimes[0] }
  if (!row.mimes.includes(m)) return null
  return { ext, kind: row.kind, mime: m }
}

/**
 * Sniff a file kind from its leading bytes (magic numbers). Returns null when unrecognised. Used to
 * reject an upload whose real bytes disagree with the declared kind (e.g. HTML renamed to .mp4).
 */
export function sniffKind(buf: Buffer): FileKind | null {
  const b = buf
  const u16 = (i: number) => (b[i] << 8) | b[i + 1]
  if (b.length >= 4) {
    // PDF
    if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf'
    // PNG
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image'
    // JPEG
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image'
    // ZIP / epub / docx-family (PK\x03\x04)
    if (b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07)) return 'other'
    // RIFF container → WAV (audio) or WEBP (image)
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b.length >= 12) {
      const tag = b.slice(8, 12).toString('ascii')
      if (tag === 'WAVE') return 'audio'
      if (tag === 'WEBP') return 'image'
    }
    // MP3 with ID3 tag, or a raw MPEG-audio frame sync
    if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return 'audio'
    if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return 'audio'
  }
  // ISO-BMFF (mp4/mov/m4a): 'ftyp' box at offset 4, brand decides video vs audio.
  if (b.length >= 12 && b.slice(4, 8).toString('ascii') === 'ftyp') {
    const brand = b.slice(8, 12).toString('ascii')
    if (brand.startsWith('M4A') || brand === 'M4B ') return 'audio'
    return 'video'
  }
  // WebM / Matroska (EBML header)
  if (b.length >= 4 && u16(0) === 0x1a45 && b[2] === 0xdf && b[3] === 0xa3) return 'video'
  return null
}

/** Current tenant's plan quota + committed usage + bytes reserved by recent open upload sessions. */
export async function getPlanLimits(): Promise<PlanLimits> {
  const base = await getCommittedLimits()
  const pending = await queryOne<{ bytes: string }>(
    `SELECT COALESCE(SUM(declared_bytes), 0) AS bytes FROM upload_sessions
      WHERE status = 'open' AND created_at > now() - interval '1 hour'`
  )
  return { ...base, usedStorageBytes: base.usedStorageBytes + Number(pending?.bytes ?? 0) }
}

// getCurrentTenantId() is empty in route handlers (no runWithTenantContext around them), so always
// resolve the tenant from the request.
export async function getCommittedLimits(): Promise<PlanLimits> {
  const tenantId = await resolveTenantId()
  if (!tenantId) {
    // Platform/flagship store (no tenant row): generous local defaults, usage untracked.
    return { storageQuotaBytes: 1024 ** 4, maxFileBytes: 5 * 1024 ** 3, usedStorageBytes: 0, fileCount: 0 }
  }
  const r = await controlPlanePool().query<{
    storage_quota_bytes: string
    max_file_bytes: string
    used_storage_bytes: string
    file_count: number
  }>(
    `SELECT COALESCE(p.storage_quota_bytes, 10737418240) AS storage_quota_bytes,
            COALESCE(p.max_file_bytes, 5368709120) AS max_file_bytes,
            COALESCE(i.used_storage_bytes, 0) AS used_storage_bytes,
            COALESCE(i.file_count, 0) AS file_count
       FROM tenants t
       LEFT JOIN plans p ON p.id = t.plan_id
       LEFT JOIN tenant_infra i ON i.tenant_id = t.id
      WHERE t.id = $1`,
    [tenantId]
  )
  const row = r.rows[0]
  if (!row) throw new Error('tenant/plan not found for quota check')
  return {
    storageQuotaBytes: Number(row.storage_quota_bytes),
    maxFileBytes: Number(row.max_file_bytes),
    usedStorageBytes: Number(row.used_storage_bytes),
    fileCount: Number(row.file_count),
  }
}

/**
 * Atomically add bytes to usage only if the result stays within the plan quota. A single conditional
 * UPDATE, so two concurrent completes can't both pass a read-then-check. True when claimed (or when
 * the store has no tenant row, whose usage is untracked).
 */
export async function claimUsage(bytes: number): Promise<boolean> {
  const tenantId = await resolveTenantId()
  if (!tenantId) return true
  const r = await controlPlanePool().query(
    `UPDATE tenant_infra i
        SET used_storage_bytes = i.used_storage_bytes + $2,
            file_count = i.file_count + 1,
            updated_at = now()
       FROM tenants t
       LEFT JOIN plans p ON p.id = t.plan_id
      WHERE i.tenant_id = $1 AND t.id = i.tenant_id
        AND i.used_storage_bytes + $2 <= COALESCE(p.storage_quota_bytes, 10737418240)
      RETURNING i.tenant_id`,
    [tenantId, bytes]
  )
  return (r.rowCount ?? 0) > 0
}

export async function bumpUsage(deltaBytes: number, deltaFiles: number): Promise<void> {
  const tenantId = await resolveTenantId()
  if (!tenantId) return
  // Clamp at zero so a double-decrement can never drive usage negative.
  await controlPlanePool().query(
    `UPDATE tenant_infra
        SET used_storage_bytes = GREATEST(0, used_storage_bytes + $2),
            file_count = GREATEST(0, file_count + $3),
            updated_at = now()
      WHERE tenant_id = $1`,
    [tenantId, deltaBytes, deltaFiles]
  )
}

export interface ReserveInput {
  productId: string
  displayName: string
  mimeType: string
  declaredBytes: number
  uploadedBy?: string | null
}

export interface ReserveResult {
  sessionId: string
  uploadUrl: string
  storageKey: string
  storageDriver: 's3' | 'local'
  kind: FileKind
  /** The exact Content-Type the client must PUT with (signed into S3 presigned PUTs). */
  mimeType: string
}

export async function reserveUpload(input: ReserveInput): Promise<ReserveResult> {
  const name = input.displayName.trim().slice(0, 255)
  const cls = classifyUpload(name, input.mimeType)
  if (!cls) throw new VaultFileError('unsupported file type', 415)

  const declared = Math.max(0, Math.floor(input.declaredBytes))
  if (!declared) throw new VaultFileError('declared size required', 400)

  const limits = await getPlanLimits()
  if (declared > limits.maxFileBytes) throw new VaultFileError('file exceeds per-file size limit', 413)
  if (limits.usedStorageBytes + declared > limits.storageQuotaBytes)
    throw new VaultFileError('storage quota exceeded', 413)

  const driver = getStorageDriver()
  const fileId = randomUUID()
  const storageKey = vaultStagingKey(await resolveTenantId(), input.productId, fileId, cls.ext)
  const uploadUrl = await driver.signUpload(storageKey, cls.mime)

  const session = await queryOne<{ id: string }>(
    `INSERT INTO upload_sessions
       (product_id, storage_driver, storage_key, display_name, mime_type, declared_bytes, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, 'open', $7)
     RETURNING id`,
    [input.productId, driver.name, storageKey, name, cls.mime, declared, input.uploadedBy ?? null]
  )

  return {
    sessionId: session!.id,
    uploadUrl,
    storageKey,
    storageDriver: driver.name,
    kind: cls.kind,
    mimeType: cls.mime,
  }
}

export interface CompleteInput {
  productId: string
  sessionId: string
  downloadable?: boolean
  uploadedBy?: string | null
  /** Upload made while editing a product draft: the file stays private to it until publish. */
  draftId?: string | null
}

export interface ProductFileRow {
  id: string
  product_id: string
  kind: FileKind
  status: string
  downloadable: boolean
  storage_driver: string
  storage_key: string
  display_name: string
  original_name: string | null
  mime_type: string
  size_bytes: string
  display_order: number
  created_at: string
  /** Set on files uploaded in a draft and not yet published. */
  draft_id?: string | null
}

async function abortSession(id: string, key?: string): Promise<void> {
  if (key) await getStorageDriver().delete(key).catch(() => {})
  await queryOne(`UPDATE upload_sessions SET status='aborted', updated_at=now() WHERE id=$1`, [id])
}

/** Sniff the stored bytes (kind from the sniff), re-check quota on the real size, insert, bump usage. */
export async function completeUpload(input: CompleteInput): Promise<ProductFileRow> {
  const session = await queryOne<{
    id: string
    product_id: string
    storage_driver: 's3' | 'local'
    storage_key: string
    display_name: string
    mime_type: string
    declared_bytes: string
    status: string
  }>(
    `SELECT id, product_id, storage_driver, storage_key, display_name, mime_type, declared_bytes, status
       FROM upload_sessions WHERE id = $1 AND product_id = $2`,
    [input.sessionId, input.productId]
  )
  if (!session) throw new VaultFileError('upload session not found', 404)
  // Claim first and atomically, so a concurrent second "complete" can't claim usage or move bytes.
  const claimed = await queryOne<{ id: string }>(
    `UPDATE upload_sessions SET status='completed', updated_at=now() WHERE id=$1 AND status='open' RETURNING id`,
    [session.id]
  )
  if (!claimed) throw new VaultFileError('upload session already finalised', 409)

  const driver = getStorageDriver()
  const actualSize = await driver.size(session.storage_key)
  if (!actualSize) {
    await abortSession(session.id)
    throw new VaultFileError('uploaded object is empty or missing', 400)
  }

  const head = await readLeadingBytes(session.storage_key, 64)
  const sniffed = sniffKind(head)
  const declaredKind = classifyUpload(session.display_name, session.mime_type)?.kind ?? null
  if (!sniffed || !declaredKind || sniffed !== declaredKind) {
    await abortSession(session.id, session.storage_key)
    throw new VaultFileError('file content does not match its type', 415)
  }

  const limits = await getCommittedLimits()
  if (actualSize > limits.maxFileBytes) {
    await abortSession(session.id, session.storage_key)
    throw new VaultFileError('file exceeds per-file size limit', 413)
  }
  if (!(await claimUsage(actualSize))) {
    await abortSession(session.id, session.storage_key)
    throw new VaultFileError('storage quota exceeded', 413)
  }

  // Promote the checked bytes to the final key; the staging upload URL can no longer touch them.
  const finalKey = promotedKey(session.storage_key)
  try {
    await driver.move(session.storage_key, finalKey)
  } catch (err) {
    await bumpUsage(-actualSize, -1)
    await abortSession(session.id, session.storage_key)
    throw err
  }

  let row: ProductFileRow
  try {
    row = await withTransaction(async (client: PoolClient) => {
    const res = await client.query<ProductFileRow>(
      `INSERT INTO product_files
         (product_id, kind, status, downloadable, storage_driver, storage_key,
          display_name, original_name, mime_type, size_bytes, uploaded_by, display_order, draft_id)
       VALUES ($1, $2, 'ready', $3, $4, $5, $6, $7, $8, $9, $10,
         COALESCE((SELECT MAX(display_order) + 1 FROM product_files WHERE product_id = $1), 0), $11)
       RETURNING id, product_id, kind, status, downloadable, storage_driver, storage_key,
                 display_name, original_name, mime_type, size_bytes, display_order, created_at, draft_id`,
      [
        session.product_id,
        sniffed,
        !!input.downloadable,
        session.storage_driver,
        finalKey,
        session.display_name,
        session.display_name,
        session.mime_type,
        actualSize,
        input.uploadedBy ?? null,
        input.draftId ?? null,
      ]
    )
    return res.rows[0]
    })
  } catch (err) {
    await bumpUsage(-actualSize, -1)
    await getStorageDriver().delete(finalKey).catch(() => {})
    await abortSession(session.id)
    throw err
  }
  return row
}

function promotedKey(stagingKey: string): string {
  if (!stagingKey.startsWith('vault-staging/')) throw new VaultFileError('invalid upload key', 400)
  return `vault/${stagingKey.slice('vault-staging/'.length)}`
}

/** A draft's pending changes to live files, kept in product_drafts.fields._files until publish. */
export interface DraftFileOps {
  removed?: string[]
  downloadable?: Record<string, boolean>
}

async function draftFileOps(draftId: string): Promise<DraftFileOps> {
  const r = await queryOne<{ ops: DraftFileOps | null }>(`SELECT fields->'_files' AS ops FROM product_drafts WHERE id = $1`, [draftId])
  return r?.ops ?? {}
}

async function saveDraftFileOps(draftId: string, ops: DraftFileOps): Promise<void> {
  await queryOne(
    `UPDATE product_drafts SET fields = jsonb_set(fields, '{_files}', $2::jsonb, true), updated_at = now() WHERE id = $1`,
    [draftId, JSON.stringify(ops)]
  )
}

/** Live files; with a draft, as that draft will publish them (its uploads in, its removals out). */
export async function listFiles(productId: string, draftId?: string | null): Promise<ProductFileRow[]> {
  const rows = await queryMany<ProductFileRow>(
    `SELECT id, product_id, kind, status, downloadable, storage_driver, storage_key,
            display_name, original_name, mime_type, size_bytes, display_order, created_at, draft_id
       FROM product_files WHERE product_id = $1 AND (draft_id IS NULL OR draft_id = $2::uuid)
      ORDER BY display_order ASC, created_at ASC`,
    [productId, draftId ?? null]
  )
  if (!draftId) return rows
  const ops = await draftFileOps(draftId)
  const removed = new Set(ops.removed ?? [])
  return rows
    .filter(r => !removed.has(r.id))
    .map(r => (ops.downloadable && r.id in ops.downloadable ? { ...r, downloadable: ops.downloadable[r.id] } : r))
}

export async function setDownloadable(productId: string, fileId: string, downloadable: boolean, draftId?: string | null): Promise<boolean> {
  if (draftId) {
    const staged = await queryOne<{ id: string }>(
      `UPDATE product_files SET downloadable=$3, updated_at=now() WHERE id=$1 AND product_id=$2 AND draft_id=$4 RETURNING id`,
      [fileId, productId, downloadable, draftId]
    )
    if (staged) return true
    const live = await queryOne<{ id: string }>(`SELECT id FROM product_files WHERE id=$1 AND product_id=$2 AND draft_id IS NULL`, [fileId, productId])
    if (!live) return false
    const ops = await draftFileOps(draftId)
    await saveDraftFileOps(draftId, { ...ops, downloadable: { ...(ops.downloadable ?? {}), [fileId]: downloadable } })
    return true
  }
  const row = await queryOne<{ id: string }>(
    `UPDATE product_files SET downloadable=$3, updated_at=now()
      WHERE id=$1 AND product_id=$2 AND draft_id IS NULL RETURNING id`,
    [fileId, productId, downloadable]
  )
  return !!row
}

/** Drop the row, remove the object, decrement usage. In a draft, a live file is only marked for removal. */
export async function deleteFile(productId: string, fileId: string, draftId?: string | null): Promise<boolean> {
  if (draftId) {
    const live = await queryOne<{ id: string }>(`SELECT id FROM product_files WHERE id=$1 AND product_id=$2 AND draft_id IS NULL`, [fileId, productId])
    if (live) {
      const ops = await draftFileOps(draftId)
      await saveDraftFileOps(draftId, { ...ops, removed: [...new Set([...(ops.removed ?? []), fileId])] })
      return true
    }
  }
  // DELETE...RETURNING first so concurrent deletes can't double-decrement usage.
  const row = await queryOne<{ storage_key: string; size_bytes: string }>(
    `DELETE FROM product_files WHERE id=$1 AND product_id=$2 AND draft_id IS NOT DISTINCT FROM $3::uuid RETURNING storage_key, size_bytes`,
    [fileId, productId, draftId ?? null]
  )
  if (!row) return false
  await getStorageDriver().delete(row.storage_key).catch(() => {})
  await bumpUsage(-Number(row.size_bytes), -1)
  return true
}

/** Inside the publish transaction: apply the draft's toggles and removals. Returns the removed objects to release after commit. */
export async function applyDraftFileOpsTx(
  client: { query: (t: string, p?: unknown[]) => Promise<{ rows: any[] }> },
  productId: string,
  ops: DraftFileOps | null | undefined
): Promise<{ storage_key: string; size_bytes: string }[]> {
  for (const [id, on] of Object.entries(ops?.downloadable ?? {}))
    await client.query(`UPDATE product_files SET downloadable=$3, updated_at=now() WHERE id=$1 AND product_id=$2`, [id, productId, on])
  if (!ops?.removed?.length) return []
  const r = await client.query(
    `DELETE FROM product_files WHERE id = ANY($1::uuid[]) AND product_id = $2 AND draft_id IS NULL RETURNING storage_key, size_bytes`,
    [ops.removed, productId]
  )
  return r.rows
}

/** After commit: delete the objects of removed files and give back their quota. */
export async function releaseFileObjects(rows: { storage_key: string; size_bytes: string }[]): Promise<void> {
  for (const row of rows) {
    await getStorageDriver().delete(row.storage_key).catch(() => {})
    await bumpUsage(-Number(row.size_bytes), -1).catch(err => console.error('[vault] usage release failed', err))
  }
}

/** A discarded draft's uploads never went live: remove them. */
export async function discardDraftFiles(draftId: string): Promise<void> {
  const rows = await queryMany<{ storage_key: string; size_bytes: string }>(
    `DELETE FROM product_files WHERE draft_id = $1 RETURNING storage_key, size_bytes`,
    [draftId]
  )
  await releaseFileObjects(rows)
}

/** First n bytes of a stored object: straight off disk for the local driver, else a ranged signed GET. */
async function readLeadingBytes(key: string, n: number): Promise<Buffer> {
  const driver = getStorageDriver() as StorageDriver & { readHead?: (k: string, n: number) => Promise<Buffer> }
  if (typeof driver.readHead === 'function') return driver.readHead(key, n)
  const url = await driver.signDownload(key, { ttlSeconds: 30, disposition: 'attachment' })
  const abs = url.startsWith('http') ? url : `${process.env.VAULT_INTERNAL_ORIGIN || 'http://127.0.0.1:3000'}${url}`
  const res = await fetch(abs, { headers: { Range: `bytes=0-${n - 1}` } })
  if (!res.ok && res.status !== 206) throw new VaultFileError('could not read uploaded bytes', 502)
  return Buffer.from(await res.arrayBuffer()).subarray(0, n)
}

export class VaultFileError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message)
    this.name = 'VaultFileError'
  }
}
