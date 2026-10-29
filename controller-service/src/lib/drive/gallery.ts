import 'server-only'
import { randomUUID } from 'crypto'
import { queryMany, queryOne } from '@/lib/shared/db'
import { getS3Url, putObjectBuffer, uploadGalleryMedia } from '@/lib/shared/s3'
import { listGalleryVideos, registerGalleryVideo } from '@/lib/shared/gallery-videos'
import { GALLERY_FOLDER_ID, type DriveFile } from './types'
import { readFileBytes, type DriveFileRow, DriveError } from './files'

// The gallery inside the Drive: a system folder listing gallery_images and gallery_videos. Gallery
// files are public (CDN URLs); private Drive files become gallery items only by an explicit copy.

export async function insertGalleryImage(
  buffer: Buffer,
  fileName: string,
  mime: string,
  extra: { sourceUrl?: string | null; customName?: string | null; categoryId?: string | null } = {}
): Promise<any> {
  const result = await uploadGalleryMedia(buffer, fileName, mime)
  return queryOne(
    `INSERT INTO gallery_images (image_url, thumbnail_url, s3_key, s3_thumbnail_key, s3_bucket, file_name, file_size, mime_type, width, height, blurhash, source_url, custom_name, category_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
    [
      result.url,
      result.thumbnailUrl,
      result.s3Key,
      result.s3ThumbnailKey,
      process.env.S3_BUCKET_NAME || 'jeffi-stores-bucket',
      result.fileName,
      result.fileSize,
      result.mimeType,
      result.width,
      result.height,
      result.blurhash,
      extra.sourceUrl ?? null,
      extra.customName ?? null,
      extra.categoryId ?? null,
    ]
  )
}

/** Gallery images and videos as Drive files (newest first). */
export async function listGalleryAsFiles(opts: { search?: string; kind?: 'image' | 'video' | null; limit: number; offset: number }): Promise<{ files: DriveFile[]; total: number }> {
  const files: DriveFile[] = []
  let total = 0
  if (opts.kind !== 'video') {
    const params: unknown[] = []
    let where = ''
    if (opts.search) {
      params.push(`%${opts.search}%`)
      where = `WHERE gi.custom_name ILIKE $1 OR gi.file_name ILIKE $1`
    }
    const rows = await queryMany(
      `SELECT gi.* FROM gallery_images gi ${where} ORDER BY gi.created_at DESC LIMIT ${opts.limit} OFFSET ${opts.offset}`,
      params
    )
    const count = await queryOne<{ n: string }>(`SELECT count(*) AS n FROM gallery_images gi ${where}`, params)
    total += Number(count?.n ?? 0)
    for (const r of rows) {
      const url = r.s3_key ? await getS3Url(r.s3_key) : r.image_url
      const thumb = r.s3_thumbnail_key ? await getS3Url(r.s3_thumbnail_key) : r.thumbnail_url
      files.push({
        id: `gi:${r.id}`,
        folderId: GALLERY_FOLDER_ID,
        name: r.custom_name || r.file_name || 'image',
        mime: r.mime_type || 'image/webp',
        kind: 'image',
        size: Number(r.file_size ?? 0),
        width: r.width ?? null,
        height: r.height ?? null,
        duration: null,
        blurhash: r.blurhash ?? null,
        source: r.source || 'gallery',
        createdAt: new Date(r.created_at).toISOString(),
        uploadedBy: null,
        url,
        thumbUrl: thumb || url,
        downloadUrl: url,
        public: true,
      })
    }
  }
  if (opts.kind !== 'image') {
    const { videos, total: vt } = await listGalleryVideos({ limit: opts.limit, offset: opts.offset, search: opts.search })
    total += vt
    for (const v of videos) {
      files.push({
        id: `gv:${v.id}`,
        folderId: GALLERY_FOLDER_ID,
        name: v.label || 'video',
        mime: v.mime,
        kind: 'video',
        size: 0,
        width: v.width,
        height: v.height,
        duration: v.duration_seconds,
        blurhash: v.blurhash,
        source: v.source,
        createdAt: new Date(v.created_at).toISOString(),
        uploadedBy: null,
        url: v.url,
        thumbUrl: v.thumbnail_url,
        downloadUrl: v.url,
        public: true,
      })
    }
  }
  files.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return { files, total }
}

/** Copy a private Drive file into the public gallery (images and MP4/WebM videos). */
export async function publishToGallery(f: DriveFileRow, adminId: string | null): Promise<{ kind: 'image' | 'video'; id: string; url: string }> {
  const bytes = await readFileBytes(f)
  if (f.kind === 'image') {
    const row = await insertGalleryImage(bytes, f.name, f.mime_type, { customName: f.name.replace(/\.[^.]+$/, '') })
    return { kind: 'image', id: row.id, url: row.image_url }
  }
  if (f.kind === 'video' && (f.mime_type === 'video/mp4' || f.mime_type === 'video/webm')) {
    const key = `media/video/${randomUUID()}.${f.mime_type === 'video/mp4' ? 'mp4' : 'webm'}`
    await putObjectBuffer(key, bytes, f.mime_type)
    const v = await registerGalleryVideo({
      key,
      mime: f.mime_type,
      width: f.width,
      height: f.height,
      durationSeconds: f.duration_seconds != null ? Number(f.duration_seconds) : null,
      label: f.name.replace(/\.[^.]+$/, ''),
      createdBy: adminId,
    })
    return { kind: 'video', id: v.id, url: v.url }
  }
  throw new DriveError('Only images and MP4/WebM videos can go to the gallery', 415)
}
