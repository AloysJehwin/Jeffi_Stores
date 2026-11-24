import { describe, it, expect, vi } from 'vitest'

const m = vi.hoisted(() => ({ chat: vi.fn(), picture: vi.fn() }))
vi.mock('@/lib/site/studio/ai', () => ({ chat: m.chat }))
vi.mock('@/lib/ai/stock', () => ({ pictureFor: m.picture, searchTerms: (s: string) => s.split(/\s+/).slice(0, 4).join(' ') }))

import { cleanWords, reworkText, shapeOf, slotPicture } from '@/lib/site/studio/element-ai'
import { pageCredits } from '@/lib/ai/stock-credits'

// The editor's cheap element actions: words reworked and cleaned, a picture asked for in the slot's shape (stock
// first), and a page's own credits for the stock photos it still shows.

describe('element actions', () => {
  it('cleans the words a model gives back', () => {
    expect(cleanWords('"Fresh tea, daily"', 'x')).toBe('Fresh tea, daily')
    expect(cleanWords("Here's a shorter version: Tea daily", 'x')).toBe('Tea daily')
    expect(cleanWords('```\nNamaste\n```', 'x')).toBe('Namaste')
  })

  it('rewrites, shortens and translates through the studio chat', async () => {
    m.chat.mockResolvedValue('“चाय हर दिन ताज़ी”')
    expect(await reworkText({ text: 'Tea fresh every day', action: 'translate', language: 'Hindi' })).toBe('चाय हर दिन ताज़ी')
    const [messages, opts] = m.chat.mock.calls[0]
    expect(messages[1].content).toContain('Translate it into Hindi')
    expect(opts).toMatchObject({ modelHint: 'copy', temperature: 0.2 })
    m.chat.mockResolvedValue('')
    await expect(reworkText({ text: 'x', action: 'shorten' })).rejects.toThrow()
    await expect(reworkText({ text: '  ', action: 'rewrite' })).rejects.toThrow(/no words/)
  })

  it('asks for a picture in the slot’s shape, stock first', async () => {
    expect([shapeOf('1:1'), shapeOf('4:5'), shapeOf('16:9'), shapeOf('auto'), shapeOf(null)]).toEqual(['square', 'portrait', 'wide', 'landscape', 'landscape'])
    m.picture.mockResolvedValue({ url: 'https://cdn.example.com/stock/pexels-1.jpg', credit: { name: 'A', source: 'pexels', pageUrl: 'https://pexels.com/p/1', url: null } })
    const pic = await slotPicture({ subject: 'masala chai in a clay cup', category: 'tea shop', aspect: '1:1', seed: 7, skipGallery: true, ref: 'r' })
    expect(pic?.url).toContain('pexels')
    const req = m.picture.mock.calls[0][0]
    expect(req.stock).toMatchObject({ shape: 'square', seed: 7, skipGallery: true })
    expect(req.ai).toMatchObject({ width: 1024, height: 1024, quality: 'draft', skipGallery: true })
  })

  it('credits only the stock photos a page still shows', () => {
    const credit = { name: 'A', source: 'pexels', pageUrl: 'https://www.pexels.com/photo/1', url: null }
    const doc = {
      blocks: { a: { props: { tree: { props: { src: { k: 'lit', v: 'https://cdn.example.com/stock/pexels-1.jpg' } } } } } },
      settings: { credits: [{ image: 'https://cdn.example.com/stock/pexels-1.jpg', credit }, { image: 'https://cdn.example.com/stock/pexels-2.jpg', credit: { ...credit, name: 'B' } }] },
    }
    expect(pageCredits(doc).map(c => c.name)).toEqual(['A'])
    expect(pageCredits(null)).toEqual([])
  })
})
