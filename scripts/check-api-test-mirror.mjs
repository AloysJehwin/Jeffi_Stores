#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const testsRoot = path.join(root, 'tests/api')
const apiRoot = path.join(root, 'src/app/api')

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? walk(p) : [p]
  })
}

const missing = walk(testsRoot)
  .filter((f) => /^route(\.[^/]+)?\.test\.tsx?$/.test(path.basename(f)))
  .filter((f) => {
    const routeDir = path.join(apiRoot, path.relative(testsRoot, path.dirname(f)))
    return !['route.ts', 'route.tsx'].some((n) => fs.existsSync(path.join(routeDir, n)))
  })
  .map((f) => path.relative(root, f))

if (missing.length) {
  console.error('Route tests without a matching src/app/api route:')
  for (const f of missing) console.error(`  ${f}`)
  process.exit(1)
}
console.log('Every tests/api route test mirrors a src/app/api route.')
