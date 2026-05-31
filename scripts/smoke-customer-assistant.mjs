#!/usr/bin/env node
/**
 * End-to-end smoke test of the live customer AI assistant.
 *
 * Calls recommendProducts(userId, query) directly — same path the
 * /api/ai-assistant/recommend route uses after auth — and reports
 * the LLM-summary output + retrieved candidates for each query.
 *
 * Usage: DATABASE_URL='...' node scripts/smoke-customer-assistant.mjs
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

const QUERIES = [
  'car jack',
  'plumbing tools',
  'wrench set',
  'I need to fix a leaking tap',
  'drilling concrete walls',
  'hex bolt 1/2 inch',
  'something to lift my car',
]

const TEST_USER_ID = '9a5a94f1-01fc-4f5f-b6e3-5ca0bfd4c8c9'

async function main() {
  const { recommendProducts } = await import('../src/lib/ai-assistant.ts')
  console.log(`# Customer AI Assistant — end-to-end smoke (live LLM + RAG)\n`)
  for (const q of QUERIES) {
    console.log(`## "${q}"\n`)
    const t0 = Date.now()
    try {
      const r = await recommendProducts(TEST_USER_ID, q)
      console.log(`source: ${r.source}  ·  provider: ${r.provider || '-'}  ·  ${Date.now() - t0}ms`)
      console.log(`\n**Summary:** ${r.summary}\n`)
      if (r.recommendations?.length) {
        console.log('**Recommendations:**')
        for (const p of r.recommendations.slice(0, 3)) {
          console.log(`  - ${p.name} (${p.sku}) — ₹${p.base_price}  [stock: ${p.inventory_quantity ?? '?'}]`)
        }
      } else {
        console.log('_no products surfaced_')
      }
      console.log('')
    } catch (err) {
      console.log(`error: ${err.message}\n`)
    }
  }
}

main().catch(err => { console.error('fatal:', err); process.exit(1) })
