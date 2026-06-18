import { vi } from 'vitest'

export function makeRequest(options: {
  method?: string
  url?: string
  body?: any
  headers?: Record<string, string>
  cookies?: Record<string, string>
  searchParams?: Record<string, string>
}): Request {
  const url = new URL(options.url || 'http://localhost/api/test')
  if (options.searchParams) {
    for (const [k, v] of Object.entries(options.searchParams)) {
      url.searchParams.set(k, v)
    }
  }
  const headers = new Headers(options.headers || {})
  if (options.cookies) {
    const cookieStr = Object.entries(options.cookies).map(([k, v]) => `${k}=${v}`).join('; ')
    headers.set('cookie', cookieStr)
  }
  return new Request(url.toString(), {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
}

export async function parseResponse(res: Response) {
  const body = await res.json()
  return { status: res.status, body }
}
