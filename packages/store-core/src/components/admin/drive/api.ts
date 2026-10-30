'use client'

import { apiProofHeaders } from '@/lib/client/session-guard'
import type { ReadyAttachment } from '@/components/chat/Composer'
import type { DriveFile, DriveFolder, DriveKind, DriveLevel, DriveShare, DriveVisibility } from '@/lib/drive/types'

export interface DriveCrumb {
  id: string
  name: string
}

export interface DriveListing {
  folder: DriveFolder | null
  folders: DriveFolder[]
  files: DriveFile[]
  total: number
  path: DriveCrumb[]
}

export interface DrivePeople {
  admins: { id: string; name: string | null; email: string | null; role: string }[]
  roles: string[]
}

async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
  const json = typeof init.body === 'string'
  const res = await fetch(url, { credentials: 'include', ...init, headers: json ? { 'Content-Type': 'application/json', ...init.headers } : init.headers })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error || 'Something went wrong')
  return data as T
}

const send = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) })

export const driveApi = {
  list(p: { folder?: string; q?: string; kind?: DriveKind | ''; page?: number; trash?: boolean }, signal?: AbortSignal) {
    const sp = new URLSearchParams()
    if (p.folder) sp.set('folder', p.folder)
    if (p.q) sp.set('q', p.q)
    if (p.kind) sp.set('kind', p.kind)
    if (p.page) sp.set('page', String(p.page))
    if (p.trash) sp.set('trash', '1')
    return call<DriveListing>(`/api/admin/drive?${sp}`, { signal })
  },
  createFolder: (parentId: string | null, name: string, visibility: DriveVisibility) => call<{ folder: DriveFolder }>('/api/admin/drive/folders', send('POST', { parentId, name, visibility })),
  updateFolder: (id: string, patch: { name?: string; visibility?: DriveVisibility; parentId?: string | null }) => call<{ folder: DriveFolder }>(`/api/admin/drive/folders/${id}`, send('PATCH', patch)),
  deleteFolder: (id: string) => call(`/api/admin/drive/folders/${id}`, send('DELETE')),
  updateFile: (id: string, patch: { name?: string; folderId?: string | null }) => call<{ file: DriveFile | null }>(`/api/admin/drive/files/${id}`, send('PATCH', patch)),
  deleteFile: (id: string) => call(`/api/admin/drive/files/${id}`, send('DELETE')),
  restoreFile: (id: string) => call(`/api/admin/drive/files/${id}/restore`, send('POST')),
  publish: (id: string) => call<{ kind: 'image' | 'video'; id: string; url: string; row?: unknown }>(`/api/admin/drive/files/${id}/publish`, send('POST')),
  shares: (t: ShareTarget) => call<{ shares: DriveShare[] }>(shareUrl(t)),
  addShare: (t: ShareTarget, who: { adminId?: string; role?: string }, level: DriveLevel) => call<{ shares: DriveShare[] }>(shareUrl(t), send('POST', { ...who, level })),
  removeShare: (t: ShareTarget, shareId: string) => call<{ shares: DriveShare[] }>(`${shareUrl(t)}?shareId=${encodeURIComponent(shareId)}`, send('DELETE')),
  people: () => call<DrivePeople>('/api/admin/drive/people'),
}

export type ShareTarget = { kind: 'folder' | 'file'; id: string }
const shareUrl = (t: ShareTarget) => `/api/admin/drive/${t.kind === 'folder' ? 'folders' : 'files'}/${t.id}/shares`

/** XHR for the progress bar; it isn't window.fetch, so it carries the session proof itself. */
export async function uploadDriveFile(file: File, folderId: string | null, onProgress?: (pct: number) => void): Promise<{ file?: DriveFile; gallery?: { id: string; url: string } }> {
  const url = '/api/admin/drive/files'
  const proof = await apiProofHeaders('POST', url)
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.withCredentials = true
    for (const [k, v] of Object.entries(proof)) xhr.setRequestHeader(k, v)
    xhr.upload.onprogress = e => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100))
    xhr.onload = () => {
      let d: any = {}
      try {
        d = JSON.parse(xhr.responseText)
      } catch {
        /* not json */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(d)
      else reject(new Error(d?.error || (xhr.status === 413 ? 'File too large' : 'Upload failed')))
    }
    xhr.onerror = () => reject(new Error('Upload failed'))
    const fd = new FormData()
    fd.append('file', file)
    if (folderId) fd.append('folderId', folderId)
    xhr.send(fd)
  })
}

/** A picked Drive file as a chat attachment (the server re-checks access on send). */
export const driveToAttachment = (f: DriveFile): ReadyAttachment => ({
  id: f.id,
  kind: f.kind,
  mime: f.mime,
  name: f.name,
  size: f.size,
  width: f.width,
  height: f.height,
  previewUrl: f.kind === 'image' ? (f.thumbUrl ?? f.url) : null,
})
