// Uploaded and AI videos in gallery_videos: register a browser upload (presigned PUT to S3) after
// checking the object, and list them for the media picker.
import { queryMany, queryOne } from '@/lib/shared/db'
import {
  currentBucket,
  deleteObjectKey,
  getS3Url,
  inspectObject,
  GALLERY_VIDEO_KEY_RE,
  GALLERY_VIDEO_MAX_BYTES,
  GALLERY_VIDEO_TYPES,
  type GalleryVideoMime,
} from '@/lib/shared/s3'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'

export interface GalleryVideo {
  id: string
  url: string
  mime: string
  duration_seconds: number | null
  width: number | null
  height: number | null
  aspect: string | null
  thumbnail_url: string | null
  blurhash: string | null
  label: string | null
  source: string
  prompt_text: string | null
  created_at: string
}

export class GalleryVideoError extends Error {
  constructor(
    message: string,
    public readonly status = 400
  ) {
    super(message)
  }
}

/** MP4 carries an ISO-BMFF 'ftyp' box at offset 4; WebM opens with the EBML header. */
export function looksLikeVideo(head: Buffer, mime: GalleryVideoMime): boolean {
  if (mime === 'video/mp4') return head.length >= 8 && head.subarray(4, 8).toString('ascii') === 'ftyp'
  return head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3
}

function ratio(w?: number | null, h?: number | null): string | null {
  if (!w || !h) return null
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)
  const g = gcd(w, h)
  return `${w / g}:${h / g}`
}

const httpUrl = (u?: string | null) => (u && /^https?:\/\//i.test(u) ? u.slice(0, 2000) : null)

type VideoRow = GalleryVideo & { s3_bucket: string; s3_key: string }

// The URL follows the current key prefix (as gallery images do) when the object is in this bucket.
async function present(row: VideoRow, bucket: string): Promise<GalleryVideo> {
  return {
    id: row.id,
    url: row.s3_bucket === bucket ? await getS3Url(row.s3_key) : row.url,
    mime: row.mime,
    duration_seconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
    width: row.width,
    height: row.height,
    aspect: row.aspect,
    thumbnail_url: row.thumbnail_url,
    blurhash: row.blurhash,
    label: row.label,
    source: row.source,
    prompt_text: row.prompt_text,
    created_at: row.created_at,
  }
}

export interface RegisterVideoInput {
  key: string
  mime: GalleryVideoMime
  durationSeconds?: number | null
  width?: number | null
  height?: number | null
  posterUrl?: string | null
  posterBlurhash?: string | null
  label?: string | null
  createdBy?: string | null
}

/** Records an upload once the object is in S3 and is the declared, size-capped video; removes it otherwise. */
export async function registerGalleryVideo(input: RegisterVideoInput): Promise<GalleryVideo> {
  if (!GALLERY_VIDEO_KEY_RE.test(input.key) || !input.key.endsWith(`.${GALLERY_VIDEO_TYPES[input.mime]}`)) {
    throw new GalleryVideoError('Unknown upload key')
  }
  const obj = await inspectObject(input.key)
  if (!obj || !obj.size) throw new GalleryVideoError('The upload has not arrived. Try again.')
  const reject = async (msg: string, status: number) => {
    await deleteObjectKey(input.key).catch(() => {})
    throw new GalleryVideoError(msg, status)
  }
  if (obj.size > GALLERY_VIDEO_MAX_BYTES) await reject('Video must be under 50 MB', 413)
  if (obj.contentType && obj.contentType !== input.mime) await reject('The uploaded file is not the declared type', 415)
  if (!looksLikeVideo(obj.head, input.mime)) await reject('The uploaded file is not an MP4 or WebM video', 415)

  const bucket = await currentBucket()
  const url = await getS3Url(input.key)
  const duration =
    input.durationSeconds && Number.isFinite(input.durationSeconds)
      ? Math.min(9999, Math.round(input.durationSeconds * 100) / 100)
      : null
  const row = await queryOne<VideoRow>(
    `INSERT INTO gallery_videos (tenant_id, s3_bucket, s3_key, url, mime, duration_seconds, aspect, width, height, thumbnail_url, blurhash, label, source, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'upload', $13)
     ON CONFLICT (s3_bucket, s3_key) DO UPDATE
       SET thumbnail_url = COALESCE(EXCLUDED.thumbnail_url, gallery_videos.thumbnail_url),
           blurhash = COALESCE(EXCLUDED.blurhash, gallery_videos.blurhash),
           label = COALESCE(EXCLUDED.label, gallery_videos.label),
           updated_at = now()
     RETURNING *`,
    [
      await resolveTenantId(),
      bucket,
      input.key,
      url,
      input.mime,
      duration,
      ratio(input.width, input.height),
      input.width || null,
      input.height || null,
      httpUrl(input.posterUrl),
      input.posterBlurhash?.slice(0, 64) || null,
      input.label?.trim().slice(0, 200) || null,
      input.createdBy ?? null,
    ]
  )
  if (!row) throw new GalleryVideoError('Could not save the video', 500)
  return present(row, bucket)
}

/** Newest first; this store's rows plus untagged ones from before tenant_id was set. */
export async function listGalleryVideos(opts: {
  limit: number
  offset: number
  search?: string
}): Promise<{ videos: GalleryVideo[]; total: number }> {
  const params: unknown[] = [await resolveTenantId()]
  let where = `WHERE ($1::uuid IS NULL OR gv.tenant_id IS NULL OR gv.tenant_id = $1::uuid)`
  if (opts.search) {
    params.push(`%${opts.search}%`)
    where += ` AND (gv.label ILIKE $${params.length} OR gv.prompt_text ILIKE $${params.length})`
  }
  const rows = await queryMany<VideoRow>(
    `SELECT gv.id, gv.url, gv.s3_bucket, gv.s3_key, gv.mime, gv.duration_seconds, gv.width, gv.height, gv.aspect,
            gv.thumbnail_url, gv.blurhash, gv.label, gv.source, gv.prompt_text, gv.created_at
       FROM gallery_videos gv ${where}
      ORDER BY gv.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, opts.limit, opts.offset]
  )
  const count = await queryOne<{ total: string }>(`SELECT COUNT(*) AS total FROM gallery_videos gv ${where}`, params)
  const bucket = await currentBucket()
  return { videos: await Promise.all((rows || []).map(r => present(r, bucket))), total: Number(count?.total ?? 0) }
}
