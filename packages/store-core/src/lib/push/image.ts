import { createHash } from 'node:crypto'

// FCM's Android SDK downloads a notification image only up to 1 MB; past that the notification shows
// without it (no picture when expanded). Heavier images go out as a resized JPEG copy on S3, made once
// per source and bucket. Any failure keeps the original URL.

const KEEP_BYTES = 700 * 1024
const KEEP_TYPES = /^image\/(jpeg|png|webp)\b/i
const MAX_EDGE = 1024
const memo = new Map<string, Promise<string>>()

export async function fcmImage(url: string | null | undefined): Promise<string | undefined> {
  const src = url?.trim()
  if (!src || !/^https:\/\//i.test(src)) return undefined
  const { currentBucket } = await import('@/lib/shared/s3')
  const key = `${await currentBucket().catch(() => '')}|${src}`
  let p = memo.get(key)
  if (!p) {
    if (memo.size >= 200) memo.clear()
    p = shrink(src).catch(() => {
      memo.delete(key)
      return src
    })
    memo.set(key, p)
  }
  return p
}

async function shrink(src: string): Promise<string> {
  const { fetchPublic } = await import('@/lib/shared/safe-fetch')
  const { bytes, type } = await fetchPublic(src, 20 * 1024 * 1024)
  if (bytes.length <= KEEP_BYTES && KEEP_TYPES.test(type)) return src
  const { getS3Url, inspectObject, putObjectBuffer } = await import('@/lib/shared/s3')
  const key = `push/${createHash('sha1').update(src).digest('hex')}.jpg`
  if (!(await inspectObject(key, 1))) {
    const sharp = (await import('sharp')).default
    let out: Buffer
    let quality = 80
    do {
      out = await sharp(bytes)
        .rotate()
        .resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer()
      quality -= 20
    } while (out.length > KEEP_BYTES && quality >= 40)
    await putObjectBuffer(key, out, 'image/jpeg')
  }
  return getS3Url(key)
}
