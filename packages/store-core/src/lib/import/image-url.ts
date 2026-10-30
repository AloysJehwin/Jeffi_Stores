import { lookup } from 'dns/promises'
import net from 'net'

const MAX_IMAGE_BYTES = 15 * 1024 * 1024
const FETCH_TIMEOUT_MS = 20_000

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    )
  }
  const v6 = ip.toLowerCase()
  if (v6.startsWith('::ffff:')) return isPrivateIp(v6.slice(7))
  return v6 === '::' || v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80')
}

/** Why an image URL cannot be imported, or null when it looks fetchable (syntax only, no network). */
export function imageUrlProblem(raw: string): string | null {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return 'not a valid URL'
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'must start with http:// or https://'
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    return 'points at a private address'
  }
  if (net.isIP(host) && isPrivateIp(host)) return 'points at a private address'
  return null
}

async function assertPublic(url: string): Promise<void> {
  const problem = imageUrlProblem(url)
  if (problem) throw new Error(problem)
  const host = new URL(url).hostname.replace(/^\[|\]$/g, '')
  if (net.isIP(host)) return
  const addrs = await lookup(host, { all: true }).catch(() => [])
  if (addrs.length === 0) throw new Error('host not found')
  if (addrs.some(a => isPrivateIp(a.address))) throw new Error('points at a private address')
}

/** Fetch an image named in an import sheet: public hosts only, with a timeout and a size cap. */
export async function fetchImportImage(url: string): Promise<Buffer> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    let current = url
    let res: Response
    // Follow redirects by hand so each hop is checked against private addresses.
    for (let hop = 0; ; hop++) {
      await assertPublic(current)
      res = await fetch(current, { signal: ctrl.signal, redirect: 'manual' })
      const next = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null
      if (!next) break
      if (hop >= 4) throw new Error('too many redirects')
      current = new URL(next, current).toString()
    }
    if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`)
    const type = res.headers.get('content-type') || ''
    if (type && !type.startsWith('image/') && !type.startsWith('application/octet-stream')) {
      throw new Error(`not an image (${type.split(';')[0]})`)
    }
    const len = Number(res.headers.get('content-length'))
    if (len > MAX_IMAGE_BYTES) throw new Error('image is larger than 15 MB')
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length === 0) throw new Error('image is empty')
    if (buf.length > MAX_IMAGE_BYTES) throw new Error('image is larger than 15 MB')
    return buf
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw new Error('download timed out')
    throw e
  } finally {
    clearTimeout(timer)
  }
}
