import { describe, it, expect, vi } from 'vitest'
import { formFile, readForm, readUpload } from '@/lib/shared/form-file'

const raw = (body: Buffer, headers: Record<string, string>) =>
  ({ headers: new Headers(headers), arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length) }) as unknown as Request

describe('form-file', () => {
  it('reads a multipart upload', async () => {
    const fd = new FormData()
    fd.append('file', new Blob(['png'], { type: 'image/png' }), 'a.png')
    const file = formFile(await readForm(new Request('http://x', { method: 'POST', body: fd }), 't'), 'file', 't')
    expect(file?.type).toBe('image/png')
    expect(file?.size).toBe(3)
  })

  it('returns null and logs what arrived when the body does not parse', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const form = await readForm(new Request('http://x', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } }), 't')
    expect(form).toBeNull()
    expect(err).toHaveBeenCalledWith('[t] multipart parse failed', expect.objectContaining({ type: 'application/json', received: 2, head: '{}' }))
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

  it('reads a raw upload with its name and fields from headers', async () => {
    const up = await readUpload(raw(Buffer.from('jpeg!'), {
      'content-type': 'image/jpeg', 'content-length': '5', 'x-file-name': encodeURIComponent('IMG 1.jpg'), 'x-upload-templateid': 'tpl-1',
    }), 't')
    expect(up).toMatchObject({ mime: 'image/jpeg', name: 'IMG 1.jpg' })
    expect('error' in up ? null : up.field('templateId')).toBe('tpl-1')
    expect('error' in up ? null : up.bytes.toString()).toBe('jpeg!')
  })

  it('rejects a raw upload that lost bytes on the way', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const up = await readUpload(raw(Buffer.from('jpe'), { 'content-type': 'image/jpeg', 'content-length': '5' }), 't')
    expect(up).toEqual({ error: 'Upload incomplete (received 3 of 5 bytes), please try again' })
    expect(err).toHaveBeenCalledWith('[t] incomplete body', { type: 'image/jpeg', expected: 5, received: 3 })
    err.mockRestore()
  })

  it('reads a multipart upload with its fields', async () => {
    const fd = new FormData()
    fd.append('file', new Blob(['gif'], { type: 'image/gif' }), 'a.gif')
    fd.append('templateId', 'tpl-2')
    const up = await readUpload(new Request('http://x', { method: 'POST', body: fd }), 't')
    expect(up).toMatchObject({ mime: 'image/gif' })
    expect('error' in up ? null : up.bytes.toString()).toBe('gif')
    expect('error' in up ? null : up.field('templateId')).toBe('tpl-2')
  })
})
