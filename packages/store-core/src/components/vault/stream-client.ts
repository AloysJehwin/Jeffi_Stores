'use client'

// Client helper: ask the stream route for a short-lived signed URL for an owned file.
// `download` only succeeds server-side when the master && file flags both allow it.

export interface StreamResult {
  url: string
  disposition: 'inline' | 'attachment'
  kind: string
  mimeType: string
}

export async function fetchStreamUrl(fileId: string, download = false): Promise<StreamResult> {
  const qs = new URLSearchParams({ file: fileId })
  if (download) qs.set('download', '1')
  const res = await fetch(`/api/vault/stream?${qs.toString()}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`stream ${res.status}`)
  return res.json()
}
