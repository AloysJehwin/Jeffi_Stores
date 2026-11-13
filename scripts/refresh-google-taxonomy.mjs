#!/usr/bin/env node
// Regenerates packages/store-core/src/lib/catalog/google-taxonomy.json from Google's published taxonomy.
// Usage: node scripts/refresh-google-taxonomy.mjs [path-to-local-taxonomy-with-ids.txt]
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const URL = 'https://www.google.com/basepages/producttype/taxonomy-with-ids.en-US.txt'
const out = join(dirname(fileURLToPath(import.meta.url)), '../packages/store-core/src/lib/catalog/google-taxonomy.json')

const text = process.argv[2] ? readFileSync(process.argv[2], 'utf8') : await (await fetch(URL)).text()
const version = text.match(/Version:\s*(\S+)/)?.[1] ?? 'unknown'
const entries = text
  .split('\n')
  .map(l => l.match(/^(\d+) - (.+)$/))
  .filter(Boolean)
  .map(m => [Number(m[1]), m[2].trim()])
if (entries.length < 1000) throw new Error(`Only ${entries.length} entries parsed — refusing to overwrite`)
writeFileSync(out, JSON.stringify({ version, entries }) + '\n')
console.log(`Wrote ${entries.length} entries (version ${version}) to ${out}`)
