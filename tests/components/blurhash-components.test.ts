import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

const canvas = read('src/components/ui/BlurhashCanvas.tsx')
const imgWithSkeleton = read('src/components/ui/ImgWithSkeleton.tsx')
const storeImage = read('src/components/visitor/StoreImage.tsx')
const adminImage = read('src/components/admin/AdminImage.tsx')

describe('BlurhashCanvas', () => {
  it('validates the hash before decoding', () => {
    expect(canvas).toContain('isBlurhashValid')
  })

  it('renders nothing when decoding fails, so a caller can fall back', () => {
    expect(canvas).toContain('if (failed) return null')
  })

  it('is decorative for screen readers', () => {
    expect(canvas).toContain('aria-hidden="true"')
  })

  it('carries no auth or fetch logic (shared across trust boundaries)', () => {
    expect(canvas).not.toMatch(/fetch\(|credentials|Authorization|token/i)
  })
})

describe('skeleton fallback contract', () => {
  for (const [name, src] of [
    ['ImgWithSkeleton', imgWithSkeleton],
    ['StoreImage', storeImage],
    ['AdminImage', adminImage],
  ] as const) {
    it(`${name} falls back to the shimmer when no hash is present`, () => {
      expect(src).toContain('blurhash')
      expect(src).toContain('img-shimmer')
      // the blurhash branch must be conditional on a truthy hash
      expect(src).toMatch(/blurhash\s*\n?\s*\?\s*<BlurhashCanvas/)
    })

    it(`${name} still resolves loading state on error`, () => {
      expect(src).toContain('onError')
    })

    it(`${name} catches images already in cache`, () => {
      expect(src).toContain('naturalWidth > 0')
    })
  }
})

describe('trust boundary separation', () => {
  it('storefront and admin images are distinct components', () => {
    expect(storeImage).not.toContain('AdminImage')
    expect(adminImage).not.toContain('StoreImage')
  })

  it('both share only the presentational canvas primitive', () => {
    expect(storeImage).toContain("from '@/components/ui/BlurhashCanvas'")
    expect(adminImage).toContain("from '@/components/ui/BlurhashCanvas'")
  })

  it('StoreImage supports LCP prioritisation', () => {
    expect(storeImage).toContain('fetchPriority')
    expect(storeImage).toContain('priority')
  })

  it('AdminImage degrades to an icon when src is missing', () => {
    expect(adminImage).toContain('!src || errored')
  })
})

describe('ImgWithSkeleton back-compat', () => {
  it('keeps blurhash optional so existing call sites still typecheck', () => {
    expect(imgWithSkeleton).toMatch(/blurhash\?:/)
  })

  it('keeps the original wrapper contract', () => {
    expect(imgWithSkeleton).toContain('relative w-full h-full')
  })
})
