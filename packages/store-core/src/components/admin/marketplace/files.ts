'use client'

// Uploads (multipart) and file downloads for the marketplace consoles.

const HEADERS = { 'x-requested-with': 'fetch' }

export async function postForm<T = any>(url: string, form: FormData): Promise<{ ok: boolean; data: T & { error?: string } }> {
  const r = await fetch(url, { method: 'POST', credentials: 'include', headers: HEADERS, body: form })
  const data = await r.json().catch(() => ({}))
  return { ok: r.ok, data }
}

/** Fetches a file response and saves it; JSON errors come back as `error`. */
export async function download(url: string, init: { method?: string; body?: BodyInit; json?: unknown } = {}): Promise<{ ok: boolean; error?: string; headers?: Headers }> {
  const r = await fetch(url, {
    method: init.method ?? 'POST',
    credentials: 'include',
    headers: { ...HEADERS, ...(init.json !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  })
  if (!r.ok) {
    const j = await r.json().catch(() => ({}))
    return { ok: false, error: j.error || 'Request failed' }
  }
  const blob = await r.blob()
  const name = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? 'download'
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
  return { ok: true, headers: r.headers }
}
