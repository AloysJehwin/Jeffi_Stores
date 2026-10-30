import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { GET } from '@storefront/app/api/(public)/vault/pdf-worker/route'

describe('pdf.js worker', () => {
  it('public fallback copy matches the installed pdfjs-dist build (no API/worker version drift)', () => {
    const root = process.cwd()
    const pub = readFileSync(path.join(root, 'storefront-service/public/vault/pdf.worker.min.mjs'))
    const pkg = readFileSync(path.join(root, 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs'))
    expect(pub.equals(pkg)).toBe(true)
  })

  it('is served same-origin as JavaScript', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/javascript/)
  })
})
