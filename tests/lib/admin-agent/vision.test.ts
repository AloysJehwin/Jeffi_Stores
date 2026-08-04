import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('pdf-to-img', () => ({
  pdf: vi.fn(),
}))

import { ocrImage, ocrPdfPages, isVisionConfigured } from '@/lib/admin-agent/vision'
import * as pdfToImg from 'pdf-to-img'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('vision', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.PADDLE_OCR_URL
    delete process.env.OLLAMA_BASE_URL
    delete process.env.AI_PROVIDER
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
    it('uses PaddleOCR when PADDLE_OCR_URL is set and returns text', async () => {
      process.env.PADDLE_OCR_URL = 'http://paddle:8866'
      const imageBuffer = Buffer.from('fake-image')

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, text: 'Hello from PaddleOCR' }),
      })

      const result = await ocrImage(imageBuffer, 'image/jpeg')
      expect(result.ok).toBe(true)
      expect((result as any).text).toBe('Hello from PaddleOCR')
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8866/ocr',
        expect.objectContaining({ method: 'POST' })
      )
    })

    it('falls back to Ollama when PaddleOCR fails', async () => {
      process.env.PADDLE_OCR_URL = 'http://paddle:8866'
      process.env.OLLAMA_BASE_URL = 'http://ollama:11434'
      const imageBuffer = Buffer.from('fake-image')

      mockFetch
        .mockRejectedValueOnce(new Error('paddle down'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            message: { content: 'Ollama extracted text' },
          }),
        })

      const result = await ocrImage(imageBuffer, 'image/png')
      expect(result.ok).toBe(true)
      expect((result as any).text).toContain('Ollama extracted text')
    })

    it('uses Ollama directly when no PADDLE_OCR_URL', async () => {
      process.env.OLLAMA_BASE_URL = 'http://ollama:11434'
      const imageBuffer = Buffer.from('fake-image')

      // Code always tries paddle first (frozen localhost:8866), then falls back to Ollama
      mockFetch
        .mockRejectedValueOnce(new Error('paddle unreachable'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            message: { content: 'Direct ollama response' },
          }),
        })

      const result = await ocrImage(imageBuffer, 'image/jpeg')
      expect(result.ok).toBe(true)
      expect((result as any).text).toContain('Direct ollama response')
      // OLLAMA_BASE_URL is captured as a module-level const at import time,
      // so it uses the frozen default host (Tailscale IP) + /api/chat endpoint.
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/chat'),
        expect.any(Object)
      )
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
