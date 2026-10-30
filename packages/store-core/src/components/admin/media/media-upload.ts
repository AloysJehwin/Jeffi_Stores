import type { GalleryVideo } from '@/components/admin/GalleryPicker'

// Browser-side gallery uploads shared by MediaField, VideoUrlInput and the template header.

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
export const VIDEO_TYPES = ['video/mp4', 'video/webm']
export const IMAGE_MAX = 5 * 1024 * 1024
export const VIDEO_MAX = 50 * 1024 * 1024

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(j.error || `Request failed (${res.status})`)
  return j as T
}

/** Uploads to the gallery (keeps GIF animation, returns the blurhash). */
export async function galleryUpload(file: Blob, name: string): Promise<{ url: string; blurhash: string | null }> {
  const form = new FormData()
  form.append('file', file, name)
  const res = await fetch('/api/gallery/upload', { method: 'POST', credentials: 'include', body: form })
  const j = await res.json().catch(() => ({}))
  if (!res.ok || !j.image_url) throw new Error(j.error || 'Upload failed')
  return { url: j.image_url, blurhash: j.blurhash ?? null }
}

interface VideoFileInfo {
  durationSec: number | null
  width: number | null
  height: number | null
  poster: Blob | null
}

/** Reads duration and size from a local video file and draws a frame as a JPEG poster. The file is a
 * blob URL, so the canvas is never tainted; any failure just means no poster. */
export function readVideoFile(file: File): Promise<VideoFileInfo> {
  return new Promise(resolve => {
    const src = URL.createObjectURL(file)
    const v = document.createElement('video')
    v.muted = true
    v.playsInline = true
    v.preload = 'auto'
    let settled = false
    const info = (): Omit<VideoFileInfo, 'poster'> => ({
      durationSec: Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null,
      width: v.videoWidth || null,
      height: v.videoHeight || null,
    })
    const done = (poster: Blob | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const out = { ...info(), poster }
      URL.revokeObjectURL(src)
      resolve(out)
    }
    const timer = setTimeout(() => done(null), 10_000)
    v.onerror = () => done(null)
    v.onloadedmetadata = () => {
      const d = Number.isFinite(v.duration) ? v.duration : 0
      v.currentTime = d > 0 ? Math.min(1, d / 3) : 0.1
    }
    v.onseeked = () => {
      try {
        const w = v.videoWidth
        const h = v.videoHeight
        if (!w || !h) return done(null)
        const scale = Math.min(1, 1920 / Math.max(w, h))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(w * scale)
        canvas.height = Math.round(h * scale)
        const ctx = canvas.getContext('2d')
        if (!ctx) return done(null)
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
        canvas.toBlob(b => done(b), 'image/jpeg', 0.85)
      } catch {
        done(null)
      }
    }
    v.src = src
  })
}

/** MP4/WebM -> presigned PUT -> gallery_videos row. A frame becomes the poster; else `fallbackPoster`. */
export async function uploadGalleryVideo(
  file: File,
  fallbackPoster?: { url: string; blurhash?: string | null } | null
): Promise<{ video: GalleryVideo; poster: { url: string; blurhash: string | null } | null }> {
  const meta = await readVideoFile(file)
  const up = await postJson<{ uploadUrl: string; key: string }>('/api/admin/media/videos/upload-url', {
    mimeType: file.type,
    size: file.size,
  })
  const put = await fetch(up.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file })
  if (!put.ok) throw new Error(`Upload to storage failed (${put.status})`)
  const base = file.name.replace(/\.[^.]+$/, '') || 'video'
  const poster = meta.poster ? await galleryUpload(meta.poster, `${base}-poster.jpg`).catch(() => null) : null
  const { video } = await postJson<{ video: GalleryVideo }>('/api/admin/media/videos', {
    key: up.key,
    mimeType: file.type,
    durationSeconds: meta.durationSec,
    width: meta.width,
    height: meta.height,
    posterUrl: poster?.url ?? fallbackPoster?.url ?? null,
    posterBlurhash: (poster ? poster.blurhash : fallbackPoster?.blurhash) ?? null,
    label: file.name.slice(0, 200),
  })
  return { video, poster }
}
