#!/usr/bin/env node
// Every Next route handler needs a test or a place on the shrink-only allowlist (scripts/route-tests-allowlist.json).
//
// Routes checked: every route.ts / route.tsx under <app>/src/app of the five Next apps
// (storefront, admin, business, controller, showcase).
// Tested = some *.test/*.spec file under a tests/, integration-tests/ or ui-tests/ dir imports that route file by a
// real import specifier (relative, `@/` -> store-core, `@<app>/` -> that app). No path-tail matching.
//
// Fails on: a new untested route, an allowlisted one that now has a test, an allowlisted one that is gone.
// Usage: node scripts/check-route-tests.mjs [--root <dir>] [--init | --prune]
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { APPS, walk, importedFiles, runRatchet } from './lib/test-imports.mjs'

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function routeFiles(root) {
  return APPS.flatMap((a) => walk(path.join(root, a, 'src/app')))
    .filter((f) => /[/\\]route\.tsx?$/.test(f))
    .map((f) => path.relative(root, f).split(path.sep).join('/'))
    .sort()
}

runRatchet({
  root: here,
  argv: process.argv.slice(2),
  items: routeFiles,
  tested: importedFiles,
  allowlistRel: 'scripts/route-tests-allowlist.json',
  label: 'route',
  plural: 'routes',
})
