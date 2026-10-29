// The files the assistant accepts (upload, Drive) and how each is recognised. Shared by the upload
// routes, the file reader and the chat's file picker, so it stays free of server-only imports.

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

export type Kind = 'pdf' | 'image' | 'docx' | 'pptx' | 'odf' | 'sheet' | 'text'

export const KIND_BY_MIME: Record<string, Kind> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
  'image/gif': 'image',
  'image/heic': 'image',
  'image/heif': 'image',
  'image/avif': 'image',
  'image/tiff': 'image',
  'image/bmp': 'image',
  'image/svg+xml': 'image',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.oasis.opendocument.text': 'odf',
  'application/vnd.oasis.opendocument.presentation': 'odf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'sheet',
  'application/vnd.ms-excel': 'sheet',
  'application/vnd.oasis.opendocument.spreadsheet': 'sheet',
  'text/csv': 'sheet',
  'text/tab-separated-values': 'sheet',
  'text/plain': 'text',
  'text/markdown': 'text',
  'text/html': 'text',
  'text/xml': 'text',
  'application/xml': 'text',
  'application/json': 'text',
  'application/rtf': 'text',
  'text/rtf': 'text',
}

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  avif: 'image/avif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  odp: 'application/vnd.oasis.opendocument.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  txt: 'text/plain',
  md: 'text/markdown',
  html: 'text/html',
  htm: 'text/html',
  xml: 'application/xml',
  json: 'application/json',
  rtf: 'application/rtf',
}

/** The extensions the file picker offers. */
export const ACCEPTED_EXTENSIONS = Object.keys(MIME_BY_EXT).map(e => `.${e}`)

/** The file's real type: browsers send "" or octet-stream for many, and Windows calls a CSV "ms-excel". */
export function resolveMime(filename: string | null | undefined, reported: string | null | undefined): string | null {
  const ext = (filename ?? '').toLowerCase().split('.').pop() ?? ''
  const byExt = MIME_BY_EXT[ext]
  const mime = (reported ?? '').toLowerCase().split(';')[0].trim()
  if (byExt && (!mime || mime === 'application/octet-stream' || !KIND_BY_MIME[mime] || (mime === 'application/vnd.ms-excel' && ext === 'csv'))) return byExt
  return KIND_BY_MIME[mime] ? mime : null
}

export function unsupportedMessage(mime: string): string {
  if (mime.startsWith('audio/') || mime.startsWith('video/')) return 'The assistant cannot listen to audio or watch video yet. Type out what it says, or attach a document or photo.'
  if (mime === 'application/msword' || mime === 'application/vnd.ms-powerpoint') return 'Old Word/PowerPoint files (.doc, .ppt) cannot be read. Save it as .docx, .pptx or PDF.'
  return `The assistant cannot read this file type (${mime || 'unknown'}). Attach a PDF, image, Word, Excel, PowerPoint, CSV or text file.`
}

/** Sent when the admin attaches a file without typing anything; the chat shows just the file. */
export const ATTACHMENT_PROMPT = 'Read the attached file and tell me what it is. If it is a quotation request, draft the quotation.'

/** The [attachment_id=... filename="..." mime=...] notes in a chat message, and the text without them. */
export function splitAttachmentNotes(text: string): { text: string; files: string[] } {
  const re = /\s*\[attachment_id=[^\]]*?filename="([^"]*)"[^\]]*\]/g
  const files = [...text.matchAll(re)].map(m => m[1])
  const rest = text.replace(re, '').trim()
  return { text: files.length && rest === ATTACHMENT_PROMPT ? '' : rest, files }
}
