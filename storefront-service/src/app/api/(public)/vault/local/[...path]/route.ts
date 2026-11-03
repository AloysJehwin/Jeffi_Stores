import { NextRequest, NextResponse } from 'next/server'
import { getStorageDriver } from '@/lib/vault/storage'
import { verifyLocalToken } from '@/lib/vault/vault-storage-local'
import type { LocalStorageDriver } from '@/lib/vault/vault-storage-local'

// DEV/TEST storage serve, mirroring presigned URLs: an HMAC token bound to (key, expiry, disposition)
// gates every read; a 'put' token gates upload. Disposition comes from the token, never the query.
// 404s entirely under the S3 driver.

export const dynamic = 'force-dynamic'

// Safe inline types only; anything else (html/svg/js/…) is served as an opaque octet-stream.
const SAFE_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', wav: 'audio/wav', aac: 'audio/aac',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
}

const MAX_PUT_BYTES = 5 * 1024 ** 3

// Reads only from the served prefix, uploads only into staging — an upload token can't overwrite a
// promoted (content-checked) file, and staging bytes are never served.
function keyFromParts(parts: string[], prefix: 'vault/' | 'vault-staging/'): string | null {
  const key = parts.join('/')
  if (!key.startsWith(prefix) || parts.some(p => p === '..' || p === '.' || p === '')) return null
  return key
}

function tokenDisposition(token: string): string {
  try {
    return Buffer.from(token, 'base64url').toString().split('.')[1] || 'inline'
  } catch {
    return 'inline'
  }
}

function localDriver(): LocalStorageDriver | null {
  const d = getStorageDriver()
  return d.name === 'local' ? (d as unknown as LocalStorageDriver) : null
}

const forbidden = () => NextResponse.json({ error: 'Forbidden' }, { status: 403 })

export async function GET(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const driver = localDriver()
  if (!driver) return NextResponse.json({ error: 'Not available' }, { status: 404 })

  const key = keyFromParts((await ctx.params).path, 'vault/')
  const token = request.nextUrl.searchParams.get('t') || ''
  if (!key || !verifyLocalToken(key, token)) return forbidden()
  const disp = tokenDisposition(token)
  if (disp !== 'inline' && disp !== 'attachment') return forbidden()

  let buf: Buffer
  try {
    buf = await driver.readLocal(key)
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const name = (key.split('/').pop() || 'file').replace(/["\\\r\n]/g, '')
  const ext = name.split('.').pop()?.toLowerCase() || ''
  const total = buf.length
  const headers = new Headers({
    'Content-Type': (disp === 'inline' && SAFE_TYPES[ext]) || 'application/octet-stream',
    'Content-Disposition': `${disp}; filename="${name}"`,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  })

  const m = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') || '')
  if (m && (m[1] || m[2])) {
    let start: number
    let end: number
    if (!m[1]) {
      // Suffix range: last N bytes.
      start = Math.max(0, total - parseInt(m[2], 10))
      end = total - 1
    } else {
      start = parseInt(m[1], 10)
      end = m[2] ? Math.min(parseInt(m[2], 10), total - 1) : total - 1
    }
    if (start >= total || end < start) {
      return new NextResponse(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } })
    }
    const slice = buf.subarray(start, end + 1)
    headers.set('Content-Range', `bytes ${start}-${end}/${total}`)
    headers.set('Content-Length', String(slice.length))
    return new NextResponse(new Uint8Array(slice), { status: 206, headers })
  }

  headers.set('Content-Length', String(total))
  return new NextResponse(new Uint8Array(buf), { status: 200, headers })
}

export async function PUT(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const driver = localDriver()
  if (!driver) return NextResponse.json({ error: 'Not available' }, { status: 404 })

  const key = keyFromParts((await ctx.params).path, 'vault-staging/')
  const token = request.nextUrl.searchParams.get('t') || ''
  if (!key || !verifyLocalToken(key, token) || tokenDisposition(token) !== 'put') return forbidden()
  if (Number(request.headers.get('content-length') || 0) > MAX_PUT_BYTES) {
    return NextResponse.json({ error: 'Too large' }, { status: 413 })
  }

  const body = Buffer.from(await request.arrayBuffer())
  if (body.length > MAX_PUT_BYTES) return NextResponse.json({ error: 'Too large' }, { status: 413 })
  await driver.writeLocal(key, body)
  return new NextResponse(null, { status: 200 })
}
