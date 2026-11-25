#!/usr/bin/env node
// Every component needs a test or a place on the shrink-only allowlist (scripts/component-tests-allowlist.json).
//
// Components checked:
//   packages/store-core/src/components/**/*.tsx
//   <app>-service/src/components/**/*.tsx        (storefront, admin, business, controller, showcase)
//   <app>-service/src/app/**/*Client.tsx
// Left out: index re-export barrels, *.stories.*, *.test.*, and files that export no component (no exported
// PascalCase value or default export, so hooks, constants and type-only files are skipped).
//
// Tested = some *.test/*.spec file under a tests/, integration-tests/ or ui-tests/ dir imports the file, by a real
// import specifier (relative, `@/` -> store-core, `@<app>/` -> that app). No path-tail matching. See lib/test-imports.mjs.
//
// Fails on: a new untested component, an allowlisted one that now has a test, an allowlisted one that is gone.
// Usage: node scripts/check-component-tests.mjs [--root <dir>] [--init | --prune]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { APPS, STORE_CORE, walk, importedFiles, runRatchet } from './lib/test-imports.mjs'

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const PASCAL = /^[A-Z][A-Za-z0-9]*[a-z][A-Za-z0-9]*$/

export function isReexportBarrel(src) {
  const rest = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '')
    .replace(/['"]use (client|server)['"];?/g, '')
    .replace(/export\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s*['"][^'"]+['"];?/g, '')
  return rest.trim() === ''
}

export function exportsComponent(src) {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '')
  if (/^\s*export\s+default\b/m.test(code)) return true
  for (const m of code.matchAll(/^\s*export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|function\*?|class)\s+([A-Za-z0-9_$]+)/gm)) {
    if (PASCAL.test(m[1])) return true
  }
  for (const m of code.matchAll(/^\s*export\s+(?!type\b)\{([^}]*)\}(?!\s*from)/gm)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim()
      if (PASCAL.test(name)) return true
    }
  }
  return false
}

export function componentFiles(root) {
  const dirs = [
    [path.join(root, STORE_CORE, 'src/components'), () => true],
    ...APPS.flatMap((a) => [
      [path.join(root, a, 'src/components'), () => true],
      [path.join(root, a, 'src/app'), (f) => /Client\.tsx$/.test(f)],
    ]),
  ]
  return dirs
    .flatMap(([dir, keep]) => walk(dir).filter((f) => f.endsWith('.tsx') && keep(f)))
    .filter((f) => !/\.(stories|test|spec)\.tsx$/.test(f))
    .filter((f) => {
      const src = fs.readFileSync(f, 'utf8')
      return !isReexportBarrel(src) && exportsComponent(src)
    })
    .map((f) => path.relative(root, f).split(path.sep).join('/'))
    .sort()
}

runRatchet({
  root: here,
  argv: process.argv.slice(2),
  items: componentFiles,
  tested: importedFiles,
  allowlistRel: 'scripts/component-tests-allowlist.json',
  label: 'component',
  plural: 'components',
})
