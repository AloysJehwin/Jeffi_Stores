// Pads an input image to a target aspect ratio with transparent (PNG) or black (JPEG) bars so an
// image-to-video model that infers output aspect from the input shape renders what the admin picked
// — a 1:1 product shot becomes 9:16 or 16:9 without cropping.
import sharp from 'sharp'

export type ReshapeAspect = '16:9' | '9:16' | '1:1' | '4:3' | '3:4'

export interface PaddedImage {
  buffer: Buffer
  width: number
  height: number
  mime: 'image/png' | 'image/jpeg'
  /** False when the input was already within tolerance; buffer is then the original bytes. */
  changed: boolean
}

const RATIO: Record<ReshapeAspect, number> = {
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '1:1': 1,
  '4:3': 4 / 3,
  '3:4': 3 / 4,
}

const TOLERANCE = 0.02

/**
 * Pads `buf` to the target aspect. The output canvas fully contains the input (never crops);
 * the original is centred and the padding fills the remainder.
 *
 * PNG stays PNG with transparent padding; everything else is kept as JPEG with black padding so
 * callers that can't carry alpha still get a sane output.
 */
export async function padToAspect(buf: Buffer, target: ReshapeAspect): Promise<PaddedImage> {
  const want = RATIO[target]
  if (!want) throw new Error(`padToAspect: unsupported aspect ${String(target)}`)

  const probed = await sharp(buf).metadata()
  const inputFormat = (probed.format ?? '').toLowerCase()
  const keepPng = inputFormat === 'png'
  const mime: 'image/png' | 'image/jpeg' = keepPng ? 'image/png' : 'image/jpeg'

  // Materialise EXIF orientation so width/height describe the pixels the model will see.
  const oriented = await sharp(buf).rotate().toBuffer({ resolveWithObject: true })
  const w = oriented.info.width
  const h = oriented.info.height
  if (!w || !h) throw new Error('padToAspect: could not read image dimensions')

  const natural = w / h
  if (Math.abs(natural - want) / want < TOLERANCE) {
    return { buffer: buf, width: w, height: h, mime, changed: false }
  }

  // Pick the smallest canvas that still fully contains the original.
  let canvasW: number
  let canvasH: number
  if (natural > want) {
    // Input is wider than target — grow height to reach the target.
    canvasW = w
    canvasH = Math.round(w / want)
  } else {
    // Input is taller than target — grow width.
    canvasH = h
    canvasW = Math.round(h * want)
  }
  // Even dimensions keep video encoders happy on the downstream model.
  if (canvasW % 2) canvasW += 1
  if (canvasH % 2) canvasH += 1

  const left = Math.max(0, Math.floor((canvasW - w) / 2))
  const top = Math.max(0, Math.floor((canvasH - h) / 2))
  const extend = {
    top,
    bottom: canvasH - h - top,
    left,
    right: canvasW - w - left,
    background: keepPng ? { r: 0, g: 0, b: 0, alpha: 0 } : { r: 0, g: 0, b: 0, alpha: 1 },
  }

  const pipeline = sharp(oriented.data).extend(extend)
  const out = keepPng ? await pipeline.png({ compressionLevel: 8 }).toBuffer() : await pipeline.jpeg({ quality: 90 }).toBuffer()
  return { buffer: out, width: canvasW, height: canvasH, mime, changed: true }
}

/** Pick a file extension for the padded buffer. */
export function extForMime(mime: 'image/png' | 'image/jpeg'): 'png' | 'jpg' {
  return mime === 'image/png' ? 'png' : 'jpg'
}
