import { describe, it, expect, vi, beforeEach } from 'vitest'

// Capture constructor args of the S3 commands.
const sendMock = vi.fn()
const getSignedUrlMock = vi.fn()
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class { send = sendMock },
  PutObjectCommand: class { constructor(args: any) { Object.assign(this, { _kind: 'put', ...args }) } },
  GetObjectCommand: class { constructor(args: any) { Object.assign(this, { _kind: 'get', ...args }) } },
}))
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: (...a: any[]) => getSignedUrlMock(...a) }))

const mkdirMock = vi.fn().mockResolvedValue(undefined)
const writeFileMock = vi.fn().mockResolvedValue(undefined)
const readFileMock = vi.fn()
vi.mock('node:fs/promises', () => ({ mkdir: (...a: any[]) => mkdirMock(...a), writeFile: (...a: any[]) => writeFileMock(...a), readFile: (...a: any[]) => readFileMock(...a) }))

beforeEach(() => {
  sendMock.mockReset()
  getSignedUrlMock.mockReset()
  mkdirMock.mockClear(); writeFileMock.mockClear(); readFileMock.mockReset()
})

describe('storage — S3 branch (DOCUMENTS_BUCKET set)', () => {
  const load = async () => {
    vi.resetModules()
    process.env.DOCUMENTS_BUCKET = 'my-bucket'
    return import('../src/storage.js')
  }

  it('putObject sends a PutObjectCommand with Bucket/Key/ContentType', async () => {
    const { putObject } = await load()
    sendMock.mockResolvedValue({})
    const body = Buffer.from('hello')
    await putObject('t1/a.bin', body, 'application/octet-stream')
    expect(sendMock).toHaveBeenCalledTimes(1)
    const cmd = sendMock.mock.calls[0][0]
    expect(cmd).toMatchObject({ _kind: 'put', Bucket: 'my-bucket', Key: 't1/a.bin', Body: body, ContentType: 'application/octet-stream' })
    expect(writeFileMock).not.toHaveBeenCalled()
  })

  it('putPdf forwards application/pdf content type', async () => {
    const { putPdf } = await load()
    sendMock.mockResolvedValue({})
    await putPdf('t1/doc.pdf', Buffer.from('%PDF'))
    expect(sendMock.mock.calls[0][0]).toMatchObject({ ContentType: 'application/pdf', Key: 't1/doc.pdf' })
  })

  it('getPdf returns a Buffer from transformToByteArray', async () => {
    const { getPdf } = await load()
    const bytes = new Uint8Array([1, 2, 3, 4])
    sendMock.mockResolvedValue({ Body: { transformToByteArray: async () => bytes } })
    const out = await getPdf('t1/doc.pdf')
    expect(Buffer.isBuffer(out)).toBe(true)
    expect([...out]).toEqual([1, 2, 3, 4])
    expect(sendMock.mock.calls[0][0]).toMatchObject({ _kind: 'get', Bucket: 'my-bucket', Key: 't1/doc.pdf' })
    expect(readFileMock).not.toHaveBeenCalled()
  })

  it('pdfUrl returns a signed URL, ignoring the fallback', async () => {
    const { pdfUrl } = await load()
    getSignedUrlMock.mockResolvedValue('https://signed.example/url')
    const url = await pdfUrl('t1/doc.pdf', 'https://fallback.test')
    expect(url).toBe('https://signed.example/url')
    expect(getSignedUrlMock).toHaveBeenCalledTimes(1)
    expect(getSignedUrlMock.mock.calls[0][2]).toMatchObject({ expiresIn: 3600 })
  })
})

describe('storage — local fs branch (DOCUMENTS_BUCKET unset)', () => {
  const load = async () => {
    vi.resetModules()
    delete process.env.DOCUMENTS_BUCKET
    process.env.DOCUMENTS_LOCAL_DIR = '/tmp/docs-test'
    return import('../src/storage.js')
  }

  it('putObject mkdirs the dir and writes the file (no S3)', async () => {
    const { putObject } = await load()
    const body = Buffer.from('local')
    await putObject('t2/sub/a.bin', body, 'application/octet-stream')
    expect(mkdirMock).toHaveBeenCalledTimes(1)
    expect(mkdirMock.mock.calls[0][1]).toMatchObject({ recursive: true })
    expect(writeFileMock).toHaveBeenCalledTimes(1)
    const [file, written] = writeFileMock.mock.calls[0]
    expect(file).toBe('/tmp/docs-test/t2/sub/a.bin')
    expect(written).toBe(body)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('getPdf reads from the local path', async () => {
    const { getPdf } = await load()
    readFileMock.mockResolvedValue(Buffer.from('from-disk'))
    const out = await getPdf('t2/doc.pdf')
    expect(out.toString()).toBe('from-disk')
    expect(readFileMock.mock.calls[0][0]).toBe('/tmp/docs-test/t2/doc.pdf')
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('pdfUrl returns the fallback string unchanged', async () => {
    const { pdfUrl } = await load()
    const url = await pdfUrl('t2/doc.pdf', 'https://fallback.test/here')
    expect(url).toBe('https://fallback.test/here')
    expect(getSignedUrlMock).not.toHaveBeenCalled()
  })
})
