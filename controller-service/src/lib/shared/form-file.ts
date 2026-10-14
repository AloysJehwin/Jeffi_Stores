// Upload routes: a parsed file is checked by shape, not instanceof (it can be a different File/Blob
// class than the route's globals). Both helpers log why they return null; callers only say "file required".
export async function readForm(req: Request, tag: string): Promise<FormData | null> {
  try {
    return await req.formData()
  } catch (e) {
    console.error(`[${tag}] multipart parse failed`, {
      type: req.headers.get('content-type'),
      length: req.headers.get('content-length'),
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
