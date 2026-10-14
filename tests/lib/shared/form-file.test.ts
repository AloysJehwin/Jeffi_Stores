import { describe, it, expect, vi } from 'vitest'
import { formFile, readForm } from '@/lib/shared/form-file'

describe('form-file', () => {
  it('reads a multipart upload', async () => {
    const fd = new FormData()
    fd.append('file', new Blob(['png'], { type: 'image/png' }), 'a.png')
    const file = formFile(await readForm(new Request('http://x', { method: 'POST', body: fd }), 't'), 'file', 't')
    expect(file?.type).toBe('image/png')
    expect(file?.size).toBe(3)
  })

  it('returns null and logs when the body is not multipart', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const form = await readForm(new Request('http://x', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } }), 't')
    expect(form).toBeNull()
    expect(err).toHaveBeenCalledWith('[t] multipart parse failed', expect.objectContaining({ type: 'application/json' }))
    err.mockRestore()
  })

  it('accepts a file from another Blob class, rejects text', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const foreign = { size: 1, type: 'image/png', arrayBuffer: async () => new ArrayBuffer(1) }
    const form = (v: unknown) => ({ get: () => v, keys: () => ['file'][Symbol.iterator]() }) as unknown as FormData
    expect(foreign instanceof Blob).toBe(false)
    expect(formFile(form(foreign), 'file', 't')).toBe(foreign)
    expect(formFile(form('text'), 'file', 't')).toBeNull()
    expect(err).toHaveBeenCalledWith('[t] no file in "file"', { got: 'string', fields: ['file'] })
    err.mockRestore()
  })
})
