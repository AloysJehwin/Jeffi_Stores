import { promises as fs } from 'fs'
import path from 'path'
import { appPath, repoPath } from '@/lib/shared/paths'

// pdf.js worker, served same-origin via /api so it passes the vault host's middleware (which
// rewrites non-/api paths into the vault app). Prefers the installed pdfjs-dist build so the
// worker always matches the API version; falls back to the public/ copy (standalone deploys).

export const dynamic = 'force-static'

const CANDIDATES = [
  repoPath('node_modules/pdfjs-dist/build/pdf.worker.min.mjs'),
  appPath('public/vault/pdf.worker.min.mjs'),
]

export async function GET() {
  for (const p of CANDIDATES) {
    try {
      const body = await fs.readFile(p)
      return new Response(new Uint8Array(body), {
        headers: {
          'Content-Type': 'text/javascript; charset=utf-8',
          'Cache-Control': 'public, max-age=86400',
          'X-Content-Type-Options': 'nosniff',
        },
      })
    } catch {}
  }
  return new Response('pdf worker missing', { status: 404 })
}
