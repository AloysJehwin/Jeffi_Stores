import 'server-only'
import { randomUUID } from 'crypto'
import sharp from 'sharp'
import { getS3Url, putObjectBuffer } from '@/lib/shared/s3'

// Pictures for a Showcase (logo, service pictures, work samples, client photos): resized and stored as WebP in the
// platform bucket under showcase/<owner>/, served publicly (the site and the studio preview show them).

export const SHOWCASE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const SHOWCASE_IMAGE_MAX_BYTES = 8 * 1024 * 1024

export type ShowcaseImageKind = 'logo' | 'service' | 'work' | 'avatar'

// Longest side: a logo stays crisp small, work samples fill a wide screen.
const SIZE: Record<ShowcaseImageKind, number> = { logo: 600, service: 1400, work: 2000, avatar: 400 }

export async function uploadShowcaseImage(buffer: Buffer, ownerId: string, kind: ShowcaseImageKind): Promise<{ url: string; width: number; height: number }> {
  const max = SIZE[kind]
  const img = sharp(buffer, { failOn: 'error' }).rotate().resize(max, max, { fit: 'inside', withoutEnlargement: true })
  const { data, info } = await (kind === 'logo' ? img.webp({ quality: 90, alphaQuality: 100 }) : img.webp({ quality: 82 })).toBuffer({ resolveWithObject: true })
  const key = `showcase/${ownerId}/${kind}-${randomUUID()}.webp`
  await putObjectBuffer(key, data, 'image/webp')
  return { url: await getS3Url(key), width: info.width, height: info.height }
}
