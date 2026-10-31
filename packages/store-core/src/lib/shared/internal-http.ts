import http from 'node:http'
import https from 'node:https'

export type InternalResponse = { status: number; ok: boolean; body: string }

/**
 * An HTTP call to another app in the cluster (or the dev router locally). node:http rather than fetch:
 * fetch drops a Host override, and the receiving app routes the request and resolves its store by Host.
 */
export function internalRequest(
  url: string,
  opts: { method?: string; host?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number } = {}
): Promise<InternalResponse> {
  const u = new URL(url)
  const lib = u.protocol === 'https:' ? https : http
  const headers: Record<string, string | number> = { ...opts.headers }
  if (opts.host) headers.host = opts.host
  if (opts.body) headers['content-length'] = Buffer.byteLength(opts.body)
  return new Promise((resolve, reject) => {
    const req = lib.request(
      { hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search, method: opts.method ?? 'GET', headers, timeout: opts.timeoutMs },
      res => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', chunk => (body += chunk))
        res.on('end', () => {
          const status = res.statusCode ?? 0
          resolve({ status, ok: status >= 200 && status < 300, body })
        })
      }
    )
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    if (opts.body) req.write(opts.body)
    req.end()
  })
}
