import 'server-only'
import sharp from 'sharp'

const isJpeg = (b: Buffer) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
const isPng = (b: Buffer) => b.length > 8 && b.readUInt32BE(0) === 0x89504e47

/**
 * JPEG and PNG pass through; anything else (gallery WebP, GIF) becomes a PNG of its first frame,
 * fitted within `maxEdge` when given. For consumers that read only JPEG/PNG: PDFKit, Meta ad images.
 */
export async function asJpegOrPng(buf: Buffer, maxEdge?: number): Promise<Buffer> {
  if (isJpeg(buf) || isPng(buf)) return buf
  const img = sharp(buf).rotate()
  if (maxEdge) img.resize(maxEdge, maxEdge, { fit: 'inside', withoutEnlargement: true })
  return img.png({ compressionLevel: 8 }).toBuffer()
}

/** Always a PNG (alpha kept): for a field whose clients can't show WebP. */
export async function toPng(buf: Buffer): Promise<Buffer> {
  return isPng(buf) ? buf : sharp(buf).rotate().png({ compressionLevel: 8 }).toBuffer()
}
