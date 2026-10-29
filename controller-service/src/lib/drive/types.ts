// Client-safe Drive types and the upload allow-list (shared by the picker's client-side checks).

export type DriveKind = 'image' | 'video' | 'audio' | 'pdf' | 'doc' | 'other'
export type DriveLevel = 'view' | 'edit' | 'manage'
export type DriveVisibility = 'private' | 'team' | 'shared'

export interface DriveFile {
  id: string
  folderId: string | null
  name: string
  mime: string
  kind: DriveKind
  size: number
  width: number | null
  height: number | null
  duration: number | null
  blurhash: string | null
  source: string
  createdAt: string
  uploadedBy: string | null
  /** Same-origin routes; each checks access and redirects to a short-lived signed URL. */
  url: string
  thumbUrl: string | null
  downloadUrl: string
  /** Gallery items are public: their URL is the CDN one. */
  public?: boolean
  /** What the viewer may do with it. */
  access?: DriveLevel
  deletedAt?: string | null
}

export interface DriveFolder {
  id: string
  parentId: string | null
  name: string
  visibility: DriveVisibility
  systemKey: string | null
  ownerAdminId: string | null
  ownerName: string | null
  createdAt: string
  /** What the viewer may do here. */
  access: DriveLevel
  fileCount?: number
}

export interface DriveShare {
  id: string
  adminId: string | null
  adminName: string | null
  role: string | null
  level: DriveLevel
}

/** The virtual folder that lists the public media gallery. */
export const GALLERY_FOLDER_ID = 'gallery'

export const DRIVE_MAX_FILE_BYTES = 100 * 1024 * 1024

// ext → mimes, kind. An upload must match one row by extension, the declared mime (when given) must
// be one of the row's, and the sniffed bytes must agree. Never html/svg/js or executables.
export const DRIVE_ALLOW: Array<{ ext: string; mimes: string[]; kind: DriveKind }> = [
  { ext: 'jpg', mimes: ['image/jpeg'], kind: 'image' },
  { ext: 'jpeg', mimes: ['image/jpeg'], kind: 'image' },
  { ext: 'png', mimes: ['image/png'], kind: 'image' },
  { ext: 'webp', mimes: ['image/webp'], kind: 'image' },
  { ext: 'gif', mimes: ['image/gif'], kind: 'image' },
  { ext: 'heic', mimes: ['image/heic', 'image/heif'], kind: 'image' },
  { ext: 'mp4', mimes: ['video/mp4'], kind: 'video' },
  { ext: 'mov', mimes: ['video/quicktime'], kind: 'video' },
  { ext: 'webm', mimes: ['video/webm', 'audio/webm'], kind: 'video' },
  { ext: '3gp', mimes: ['video/3gpp'], kind: 'video' },
  { ext: 'mp3', mimes: ['audio/mpeg'], kind: 'audio' },
  { ext: 'm4a', mimes: ['audio/mp4', 'audio/x-m4a', 'audio/aac'], kind: 'audio' },
  { ext: 'aac', mimes: ['audio/aac'], kind: 'audio' },
  { ext: 'ogg', mimes: ['audio/ogg', 'audio/opus'], kind: 'audio' },
  { ext: 'opus', mimes: ['audio/ogg', 'audio/opus'], kind: 'audio' },
  { ext: 'amr', mimes: ['audio/amr'], kind: 'audio' },
  { ext: 'wav', mimes: ['audio/wav', 'audio/x-wav'], kind: 'audio' },
  { ext: 'pdf', mimes: ['application/pdf'], kind: 'pdf' },
  { ext: 'docx', mimes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'], kind: 'doc' },
  { ext: 'xlsx', mimes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], kind: 'doc' },
  { ext: 'pptx', mimes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'], kind: 'doc' },
  { ext: 'csv', mimes: ['text/csv', 'application/vnd.ms-excel', 'text/plain'], kind: 'doc' },
  { ext: 'txt', mimes: ['text/plain'], kind: 'doc' },
  { ext: 'zip', mimes: ['application/zip', 'application/x-zip-compressed'], kind: 'other' },
]

export const DRIVE_ACCEPT = DRIVE_ALLOW.map(a => `.${a.ext}`).join(',')

export function driveExt(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name.trim())
  return m ? m[1].toLowerCase() : ''
}

/** The allow-list row for a declared (name, mime); null when disallowed. */
export function classifyDriveUpload(name: string, mime: string): { ext: string; kind: DriveKind; mime: string } | null {
  let ext = driveExt(name)
  const m = (mime || '').split(';')[0].trim().toLowerCase()
  // A file with no extension (pasted image, WhatsApp media) takes the extension of its mime.
  if (!ext && m) ext = DRIVE_ALLOW.find(a => a.mimes.includes(m))?.ext ?? ''
  const row = DRIVE_ALLOW.find(a => a.ext === ext)
  if (!row) return null
  if (!m || m === 'application/octet-stream') return { ext, kind: row.kind, mime: row.mimes[0] }
  if (!row.mimes.includes(m)) return null
  return { ext, kind: row.kind, mime: m }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(1)} GB`
}
