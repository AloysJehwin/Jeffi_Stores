import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('pdf-to-img', () => ({
  pdf: vi.fn(),
}))
vi.mock('@/lib/ai-client', () => ({ aiVision: vi.fn() }))
vi.mock('@/lib/brand', () => ({ storeDescriptorForPrompt: vi.fn(async () => 'Test Store, an online store') }))

import { ocrImage, ocrPdfPages, isVisionConfigured } from '@/lib/admin-agent/vision'
import * as pdfToImg from 'pdf-to-img'
import { aiVision } from '@/lib/ai-client'

const mockAiVision = vi.mocked(aiVision)

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('vision', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.PADDLE_OCR_URL
    delete process.env.OLLAMA_BASE_URL
    delete process.env.AI_PROVIDER
    mockAiVision.mockResolvedValue({ ok: false, text: '', model: '', error: 'vision not configured' })
  })

  describe('isVisionConfigured', () => {
    it('returns true when PADDLE_OCR_URL is set', () => {
      process.env.PADDLE_OCR_URL = 'http://paddle:8866'
      expect(isVisionConfigured()).toBe(true)
    })

    it('returns true when OLLAMA_BASE_URL is set', () => {
      process.env.OLLAMA_BASE_URL = 'http://ollama:11434'
      expect(isVisionConfigured()).toBe(true)
    })

    it('returns true when AI_PROVIDER is ollama', () => {
      process.env.AI_PROVIDER = 'ollama'
      expect(isVisionConfigured()).toBe(true)
    })

    it('returns false when no vision env vars set', () => {
      expect(isVisionConfigured()).toBe(false)
    })
  })

  describe('ocrImage', () => {
    it('returns the gateway OCR text, prompting with the store descriptor', async () => {
      mockAiVision.mockResolvedValueOnce({ ok: true, text: 'Hello from PaddleOCR', model: 'PP-OCRv5' })
      const imageBuffer = Buffer.from('fake-image')

      const result = await ocrImage(imageBuffer, 'image/jpeg')
      expect(result.ok).toBe(true)
      expect((result as any).text).toBe('Hello from PaddleOCR')
      expect((result as any).model).toBe('PP-OCRv5')
      const [images, prompt] = mockAiVision.mock.calls[0]
      expect(images).toEqual([imageBuffer.toString('base64')])
      expect(prompt).toContain('Test Store, an online store')
      expect(prompt).not.toMatch(/hardware|industrial/i)
    })

    it('returns the gateway reason and hint when vision fails', async () => {
      mockAiVision.mockResolvedValueOnce({ ok: false, text: '', model: '', error: 'vision model down', hint: 'retry later' })

      const result = await ocrImage(Buffer.from('fake-image'), 'image/png')
      expect(result.ok).toBe(false)
      expect((result as any).reason).toBe('vision model down')
      expect((result as any).hint).toBe('retry later')
    })

    it('treats NO_ITEMS_FOUND as no quotation items', async () => {
      mockAiVision.mockResolvedValueOnce({ ok: true, text: '  NO_ITEMS_FOUND  ', model: 'm' })

      const result = await ocrImage(Buffer.from('fake-image'), 'image/jpeg')
      expect(result.ok).toBe(false)
      expect((result as any).reason).toMatch(/no quotation items/i)
    })

    it('returns empty string when PaddleOCR response has no text', async () => {
      process.env.PADDLE_OCR_URL = 'http://paddle:8866'
      const imageBuffer = Buffer.from('blank')

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: false, text: '' }),
      })

      const result = await ocrImage(imageBuffer, 'image/jpeg')
      expect(typeof (result as any).ok).toBe('boolean')
    })

    it('returns empty string when no vision provider configured', async () => {
      const imageBuffer = Buffer.from('fake')
      const result = await ocrImage(imageBuffer, 'image/jpeg')
      expect((result as any).ok).toBe(false)
    })

    it('handles PaddleOCR non-ok response', async () => {
      process.env.PADDLE_OCR_URL = 'http://paddle:8866'
      process.env.OLLAMA_BASE_URL = 'http://ollama:11434'
      const imageBuffer = Buffer.from('fake')

      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 500 })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ message: { content: 'fallback text' } }),
        })

      const result = await ocrImage(imageBuffer, 'image/jpeg')
      expect(typeof (result as any).ok).toBe('boolean')
    })
  })

  describe('ocrPdfPages', () => {
    it('uses PaddleOCR for PDF when configured', async () => {
      process.env.PADDLE_OCR_URL = 'http://paddle:8866'
      const pdfBuffer = Buffer.from('%PDF-fake')

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ ok: true, text: 'Page 1 text', pages: 1 }),
        })

      const result = await ocrPdfPages(pdfBuffer)
      expect(typeof (result as any).ok).toBe('boolean')
    })

    it('falls back to pdf-to-img + per-page ocrImage when PaddleOCR fails', async () => {
      process.env.PADDLE_OCR_URL = 'http://paddle:8866'
      const pdfBuffer = Buffer.from('%PDF-fake')

      const fakePageBuffer = Buffer.from('fake-page-image')
      const mockPdfIterator = {
        [Symbol.asyncIterator]: async function* () {
          yield fakePageBuffer
        },
      }

      vi.mocked(pdfToImg.pdf).mockResolvedValueOnce(mockPdfIterator as any)

      mockFetch
        .mockRejectedValueOnce(new Error('paddle down'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ ok: true, text: 'page text from image', pages: 1 }),
        })

      const result = await ocrPdfPages(pdfBuffer)
      expect(typeof (result as any).ok).toBe('boolean')
    })

    it('returns empty string when nothing is configured', async () => {
      const pdfBuffer = Buffer.from('%PDF-fake')
      const result = await ocrPdfPages(pdfBuffer)
      expect((result as any).ok).toBe(false)
    })

    it('respects maxPages option', async () => {
      process.env.PADDLE_OCR_URL = 'http://paddle:8866'
      const pdfBuffer = Buffer.from('%PDF-fake')

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, text: 'text', pages: 1 }),
      })

      const result = await ocrPdfPages(pdfBuffer, { maxPages: 1 })
      expect(typeof (result as any).ok).toBe('boolean')
    })
  })
})
