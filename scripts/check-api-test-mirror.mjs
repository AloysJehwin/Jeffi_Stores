#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// Each app's route tests sit in its own tests/api and must mirror a route that app owns.
const APPS = ['storefront-service', 'admin-service', 'business-service', 'controller-service']

function walk(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? walk(p) : [p]
  })
}

// Routes live under a transparent Next.js route group: api/(admin), api/(ecom),
// api/(internal), api/(public). <app>/tests/api mirrors the URL path with no group, so
// map each top segment back to the group its route.ts actually sits in. A few
// paths are pinned flat (api/internal/migrations, matched by ci.yml's regex), so
// the flat location is also a valid mirror.
function candidateRouteDirs(apiRoot, rel) {
  const [head] = rel.split(path.sep)
  const group =
    head === 'admin'
      ? '(admin)'
      : head === 'ecom'
        ? '(ecom)'
        : head === 'internal' || head === 'cron'
          ? '(internal)'
          : '(public)'
  return [path.join(apiRoot, group, rel), path.join(apiRoot, rel)]
}

const missing = APPS.flatMap((app) => {
  const testsRoot = path.join(root, app, 'tests/api')
  const apiRoot = path.join(root, app, 'src/app/api')
  return walk(testsRoot)
    .filter((f) => /^route(\.[^/]+)?\.test\.tsx?$/.test(path.basename(f)))
    .filter((f) => {
      const dirs = candidateRouteDirs(apiRoot, path.relative(testsRoot, path.dirname(f)))
      return !dirs.some((d) => ['route.ts', 'route.tsx'].some((n) => fs.existsSync(path.join(d, n))))
    })
    .map((f) => path.relative(root, f))
})

if (missing.length) {
  console.error("Route tests without a matching route in their own app's src/app/api:")
  for (const f of missing) console.error(`  ${f}`)
  process.exit(1)
}
console.log("Every route test mirrors a route in its own app's src/app/api.")
