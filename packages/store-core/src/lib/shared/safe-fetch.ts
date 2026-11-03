import 'server-only'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

// Fetching a URL someone else typed in: http(s) on standard ports only, never a private or link-local
// address (checked again on every redirect), size-capped while streaming.

export class UnsafeFetchError extends Error {
  constructor(message: string, readonly status = 422) {
    super(message)
  }
}

const PRIVATE_V4 = [/^0\./, /^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^22[4-9]\./, /^2[3-5]\d\./]

function privateAddress(ip: string): boolean {
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip
  if (isIP(v4) === 4) return PRIVATE_V4.some(r => r.test(v4))
  const v6 = ip.toLowerCase()
  return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6)
}

async function assertPublic(url: URL): Promise<void> {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new UnsafeFetchError('Only http(s) links are allowed')
  if (url.port && !['80', '443'].includes(url.port)) throw new UnsafeFetchError('Only standard web ports are allowed')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => [])
  if (!addrs.length) throw new UnsafeFetchError(`Could not resolve ${url.hostname}`)
  if (addrs.some(a => privateAddress(a.address))) throw new UnsafeFetchError('That link points at a private address')
}

export async function fetchPublic(raw: string, maxBytes: number): Promise<{ bytes: Buffer; type: string }> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new UnsafeFetchError('Not a valid link')
  }
  for (let hop = 0; hop < 4; hop++) {
    await assertPublic(url)
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000) }).catch(e => {
      throw new UnsafeFetchError(`Could not download the link: ${(e as Error).message}`)
    })
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location')!, url)
      continue
    }
    if (!res.ok || !res.body) throw new UnsafeFetchError(`Downloading the link returned HTTP ${res.status}`)
    const tooBig = () => new UnsafeFetchError(`The file is larger than ${Math.round(maxBytes / 1048576)} MB`, 413)
    if (Number(res.headers.get('content-length') ?? 0) > maxBytes) throw tooBig()
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.length
      if (size > maxBytes) throw tooBig()
      chunks.push(Buffer.from(chunk))
    }
    return { bytes: Buffer.concat(chunks), type: (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() }
  }
  throw new UnsafeFetchError('The link redirects too many times')
}
