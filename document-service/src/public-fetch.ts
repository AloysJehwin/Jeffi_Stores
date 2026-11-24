import http from 'node:http'
import https from 'node:https'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { LookupFunction } from 'node:net'

// No hostname allowlist on purpose: this feature accepts any public host. Safety comes from vetting the
// address the socket actually connects to (a separate pre-check can be outrun by DNS rebinding).
export class PrivateAddressError extends Error {
  code = 'EPRIVATE'
  constructor(host: string) { super(`${host} resolves to a private address`) }
}

export interface PublicGetOptions { headers?: Record<string, string>; timeoutMs: number; isPrivate: (ip: string) => boolean }

/** GET `url`, connecting only to a vetted public address. Resolves with the response stream; never follows redirects. */
export function publicGet(url: URL, o: PublicGetOptions): Promise<http.IncomingMessage> {
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host) && o.isPrivate(host)) return Promise.reject(new PrivateAddressError(host))
  // The socket connects to the address this lookup returns; SNI and Host stay the URL's hostname.
  const vetted: LookupFunction = (name, opts, cb) => {
    lookup(name, { all: true }).then(addrs => {
      if (!addrs.length || addrs.some(a => o.isPrivate(a.address))) return cb(new PrivateAddressError(name), '', 4)
      if ((opts as { all?: boolean }).all) return (cb as unknown as (e: null, a: typeof addrs) => void)(null, addrs)
      cb(null, addrs[0].address, addrs[0].family)
    }, err => cb(err, '', 4))
  }
  const mod = url.protocol === 'https:' ? https : http
  return new Promise((resolve, reject) => {
    const req = mod.request(url, { method: 'GET', headers: o.headers, lookup: vetted, signal: AbortSignal.timeout(o.timeoutMs) }, resolve)
    req.on('error', reject)
    req.end()
  })
}
