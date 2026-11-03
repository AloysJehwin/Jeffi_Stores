// Upload routes. A file comes either as the raw request body (Content-Type: its type; X-File-Name and
// X-Upload-<field> headers carry the rest), checked against Content-Length, or as multipart field "file"
// (checked by shape, not instanceof). Every rejection is logged: callers only answer "file required".
export type Upload = { bytes: Buffer; mime: string; name: string | null; field: (name: string) => string | null }

const printable = (b: Buffer) => b.toString('latin1').replace(/[^\x20-\x7e]/g, '.')

export async function readForm(req: Request, tag: string): Promise<FormData | null> {
  const type = req.headers.get('content-type') || ''
  let ab: ArrayBuffer
  try {
    ab = await req.arrayBuffer()
  } catch (e) {
    console.error(`[${tag}] body read failed`, { type, error: String(e) })
    return null
  }
  const buf = Buffer.from(ab)
  try {
    return await new Response(ab, { headers: { 'content-type': type } }).formData()
  } catch (e) {
    console.error(`[${tag}] multipart parse failed`, {
      type,
      length: req.headers.get('content-length'),
      received: buf.length,
      head: printable(buf.subarray(0, 200)),
      tail: printable(buf.subarray(Math.max(0, buf.length - 80))),
      error: String(e),
    })
    return null
  }
}

export function formFile(form: FormData | null, field: string, tag: string): File | null {
  const v = form?.get(field)
  if (v && typeof v === 'object' && typeof (v as Blob).arrayBuffer === 'function') return v as File
  if (form) console.error(`[${tag}] no file in "${field}"`, { got: v == null ? String(v) : typeof v, fields: [...new Set(form.keys())] })
  return null
}

export async function readUpload(req: Request, tag: string): Promise<Upload | { error: string }> {
  const type = req.headers.get('content-type') || ''
  if (type.startsWith('multipart/form-data')) {
    const form = await readForm(req, tag)
    const file = formFile(form, 'file', tag)
    if (!form || !file) return { error: 'file required' }
    return {
      bytes: Buffer.from(await file.arrayBuffer()),
      mime: file.type || 'application/octet-stream',
      name: file.name || null,
      field: k => { const v = form.get(k); return typeof v === 'string' ? v : null },
    }
  }
  const bytes = Buffer.from(await req.arrayBuffer())
  const expected = Number(req.headers.get('content-length'))
  if (!bytes.length) return { error: 'file required' }
  if (expected > 0 && bytes.length !== expected) {
    console.error(`[${tag}] incomplete body`, { type, expected, received: bytes.length })
    return { error: `Upload incomplete (received ${bytes.length} of ${expected} bytes), please try again` }
  }
  const name = req.headers.get('x-file-name')
  return {
    bytes,
    mime: type.split(';')[0].trim() || 'application/octet-stream',
    name: name ? decodeURIComponent(name) : null,
    field: k => req.headers.get(`x-upload-${k.toLowerCase()}`),
  }
}
