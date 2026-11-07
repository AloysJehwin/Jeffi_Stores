import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

// orders.awb_number means a Delhivery shipment the store booked. Marketplace tracking lives in
// marketplace_shipments, so no marketplace code path may read or write awb_number.

const ROOT = join(__dirname, '..', '..', '..', '..', '..')
const DIRS = [
  'packages/store-core/src/lib/marketplace',
  'packages/store-core/src/components/admin/marketplace',
  'admin-service/src/app/api/(admin)/admin/myntra',
  'admin-service/src/app/api/(admin)/admin/ajio',
  'storefront-service/src/app/api/(public)/webhooks/myntra',
  'storefront-service/src/app/api/(public)/webhooks/ajio',
]

function walk(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(name) ? [full] : []
  })
}

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

describe('marketplace code never touches orders.awb_number', () => {
  const files = DIRS.flatMap(d => walk(join(ROOT, d)))

  it('finds the marketplace sources', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it('has no awb_number outside comments', () => {
    const hits = files.filter(f => /awb_number/i.test(stripComments(readFileSync(f, 'utf8')))).map(f => relative(ROOT, f))
    expect(hits).toEqual([])
  })
})
