import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/catalog/brand', () => ({ storeDescriptorForPrompt: vi.fn(async () => 'Acme Tools, an online store') }))

import { enforceCopy, ensureShortDescription, writeAdCopy } from '@/lib/google-ads/ad-copy'
import { adTextLength, clipAtWord, cleanAdText, enforceTexts, keywordProblem, cleanKeyword, textListProblems, LIMITS } from '@/lib/google-ads/limits'

const long = (n: number, word = 'word') => Array.from({ length: n }, () => word).join(' ')

describe('limits', () => {
  it('counts full-width characters as two', () => {
    expect(adTextLength('Drills')).toBe(6)
    expect(adTextLength('ドリル')).toBe(6)
    expect(adTextLength('ड्रिल')).toBe(5)
  })

  it('cleans emoji, repeated and headline exclamation marks', () => {
    expect(cleanAdText('Big   sale!!! 🔥')).toBe('Big sale!')
    expect(cleanAdText('Big sale!', { headline: true })).toBe('Big sale')
    expect(cleanAdText('"Quoted"')).toBe('Quoted')
  })

  it('clips at a word boundary or gives up when too little is left', () => {
    expect(clipAtWord('Cordless drills from top brands', 20)).toBe('Cordless drills from')
    expect(clipAtWord('Supercalifragilisticexpialidocious tools', 20)).toBeNull()
  })

  it('keeps, clips, dedupes and caps a list', () => {
    const r = enforceTexts(['Drills', 'drills', long(10), 42, '', 'Saws'], 30, { maxItems: 2 })
    expect(r.kept).toEqual(['Drills', 'word word word word word word'])
    expect(r.kept.every(k => adTextLength(k) <= 30)).toBe(true)
    expect(r.dropped).toBe(4)
  })

  it('reports list problems in words', () => {
    expect(textListProblems('Headline', ['a', 'A'], 30, [3, 15])).toEqual(['Add at least 3 headlines', 'Headlines must be unique ("A" is repeated)'])
    expect(textListProblems('Headline', ['x'.repeat(31)], 30)).toEqual(['Headline 1 is longer than 30 characters'])
  })

  it('cleans and checks keywords', () => {
    expect(cleanKeyword('Cordless, Drill!')).toBe('cordless drill')
    expect(keywordProblem(long(11, 'a'))).toMatch(/more than 10 words/)
    expect(keywordProblem('x'.repeat(81))).toMatch(/longer than 80/)
    expect(keywordProblem('drill')).toBeNull()
  })
})

describe('AI copy length enforcement', () => {
  it('RSA: headlines <= 30 without "!", descriptions <= 90, at most 15 / 4', () => {
    const r = enforceCopy('rsa', {
      headlines: ['Cordless Drills!', 'Free delivery over ₹999 on every order today', ...Array.from({ length: 20 }, (_, i) => `Headline ${i}`)],
      descriptions: [long(30), 'Short one.', 'Another one.', 'Third.', 'Fourth.', 'Fifth.'],
    }) as any
    expect(r.headlines[0]).toBe('Cordless Drills')
    expect(r.headlines).toHaveLength(15)
    expect(r.headlines.every((h: string) => adTextLength(h) <= LIMITS.headline && !h.includes('!'))).toBe(true)
    expect(r.descriptions).toHaveLength(4)
    expect(r.descriptions.every((d: string) => adTextLength(d) <= LIMITS.description)).toBe(true)
    expect(r.dropped).toBeGreaterThan(0)
  })

  it('PMax: guarantees one description of 60 characters or fewer', () => {
    const descs = [long(13), long(14)]
    expect(descs.every(d => adTextLength(d) > 60)).toBe(true)
    const out = ensureShortDescription(descs)
    expect(out.some(d => adTextLength(d) <= 60)).toBe(true)
    const r = enforceCopy('pmax', { headlines: ['A tool'], longHeadlines: [long(40)], descriptions: descs }) as any
    expect(r.longHeadlines.every((l: string) => adTextLength(l) <= LIMITS.longHeadline)).toBe(true)
    expect(r.descriptions.some((d: string) => adTextLength(d) <= LIMITS.shortDescription)).toBe(true)
  })

  it('sitelinks: link text <= 25, both description lines or neither', () => {
    const r = enforceCopy(
      'sitelinks',
      {
        sitelinks: [
          { linkText: 'Power Tools', description1: 'Drills, grinders and saws', description2: 'Top brands, fast delivery' },
          { linkText: 'Hand Tools', description1: 'Spanners and pliers', description2: long(12) },
        ],
      },
      2
    ) as any
    expect(r.sitelinks[0]).toEqual({ linkText: 'Power Tools', description1: 'Drills, grinders and saws', description2: 'Top brands, fast delivery' })
    expect(r.sitelinks[1].description1).toBe('Spanners and pliers')
    expect(adTextLength(r.sitelinks[1].description2)).toBeLessThanOrEqual(LIMITS.sitelinkDescription)
  })

  it('callouts: <= 25 characters each', () => {
    const r = enforceCopy('callouts', { callouts: ['Free delivery!', 'Cash on delivery available everywhere in India', 'GST invoice'] }) as any
    expect(r.callouts).toContain('Free delivery')
    expect(r.callouts.every((c: string) => adTextLength(c) <= LIMITS.callout)).toBe(true)
  })

  it('writes with the store descriptor in JSON mode and enforces the reply', async () => {
    const ai = vi.fn(async () => ({
      content: '```json\n{"headlines":["Cordless Drills!","' + long(9) + '"],"descriptions":["Top brands."]}\n```',
      provider: 'ollama' as const,
      model: 'm',
      latencyMs: 1,
      fallbackUsed: false,
    }))
    const r = (await writeAdCopy('rsa', { category: 'Drills', keywords: ['cordless drill'] }, ai)) as any
    const req = (ai.mock.calls[0] as any)[0]
    expect(req).toMatchObject({ jsonMode: true, modelHint: 'copy' })
    expect(req.messages[0].content).toContain('Acme Tools, an online store')
    expect(req.messages[0].content).toContain('at most 30 characters')
    expect(req.messages[1].content).toContain('Category: Drills')
    expect(r.headlines).toEqual(['Cordless Drills', 'word word word word word word'])
  })

  it('fails readably when the reply is not JSON', async () => {
    const ai = vi.fn(async () => ({ content: 'Sorry, I cannot help', provider: 'ollama' as const, model: 'm', latencyMs: 1, fallbackUsed: false }))
    await expect(writeAdCopy('callouts', {}, ai)).rejects.toThrow('could not be read')
  })
})
