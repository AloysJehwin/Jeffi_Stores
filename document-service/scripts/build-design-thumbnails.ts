// Renders each design's sample invoice and rasterises page 1 into public/designs/<key>.png (needs poppler's pdftoppm).
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { DESIGNS, renderDocument } from '../src/designs/index.js'
import { sampleRequest } from '../src/designs/sample.js'
import { computeTotals } from '../src/totals.js'

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/designs')
const tmp = mkdtempSync(path.join(tmpdir(), 'thumbs-'))
const req = sampleRequest('invoice')
for (const d of DESIGNS) {
  const pdf = path.join(tmp, `${d.key}.pdf`)
  writeFileSync(pdf, await renderDocument(d.key, 'invoice', req, computeTotals(req), 'INV/2026-27/0042', 'https://public.jeffistores.in/d/sample'))
  execFileSync('pdftoppm', ['-png', '-r', '110', '-f', '1', '-l', '1', '-singlefile', pdf, path.join(tmp, d.key)])
  await sharp(path.join(tmp, `${d.key}.png`)).resize({ width: 640 }).png({ compressionLevel: 9, palette: true }).toFile(path.join(out, `${d.key}.png`))
  console.log(d.key)
}
rmSync(tmp, { recursive: true, force: true })
