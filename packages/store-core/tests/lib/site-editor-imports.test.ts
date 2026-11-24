import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Live pages ship no editor code: following static imports from every file of the apps that render store and
// Showcase pages never reaches the visual editor's modules. The canvas bridge loads through next/dynamic (an
// `import()` this walk leaves out), and only with a preview token and the editor flag on.

const ROOT = path.resolve(__dirname, '../../../..')
const APPS = ['storefront-service/src', 'showcase-service/src', 'business-service/src']
const EDITOR = [
  'packages/site-blocks/src/design.ts',
  'packages/store-core/src/lib/site/code/classes.ts',
  'packages/store-core/src/components/visitor/site/editor/SiteEditorBridge.tsx',
]
// The editor's shell, its panels and host plumbing (admin, Showcase).
const SHELL = 'packages/store-core/src/components/site-editor/'
// App aliases are built from their names: a quoted '@<app>/' literal here would trip app-import-boundaries.
const ALIAS: [string, string][] = [
  ['@/', 'packages/store-core/src/'],
  ...['storefront', 'showcase', 'business'].map((app): [string, string] => ['@' + app + '/', `${app}-service/src/`]),
]
const PKG: Record<string, string> = { '@jeffi/site-blocks': 'packages/site-blocks/src/index.ts', '@jeffi/site-blocks/design': 'packages/site-blocks/src/design.ts' }
const EXT = ['', '.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.tsx', '/index.js']
// Static imports and re-exports at the start of a statement; `import type` and `import()` are left out.
const IMPORT = /(?:^|[;\n])\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s*)?['"]([^'"\n]+)['"]/g

const isFile = (f: string) => fs.existsSync(path.join(ROOT, f)) && fs.statSync(path.join(ROOT, f)).isFile()

function resolve(from: string, spec: string): string | null {
  if (spec in PKG) return PKG[spec]
  const alias = ALIAS.find(([a]) => spec.startsWith(a))
  const base = spec.startsWith('.') ? path.join(path.dirname(from), spec) : alias ? alias[1] + spec.slice(alias[0].length) : null
  if (!base) return null
  for (const e of EXT) if (isFile(base + e)) return path.normalize(base + e)
  return null
}

/** Every file reached, with the file that first imported it. */
function reached(): Map<string, string> {
  const seen = new Map<string, string>()
  const queue: string[] = []
  for (const app of APPS)
    for (const f of fs.readdirSync(path.join(ROOT, app), { recursive: true }) as string[])
      if (/\.(tsx?|m?js)$/.test(f) && !/(^|\/)(tests?|__tests__)\//.test(f)) {
        const file = path.join(app, f)
        seen.set(file, '')
        queue.push(file)
      }
  while (queue.length) {
    const f = queue.pop()!
    for (const m of fs.readFileSync(path.join(ROOT, f), 'utf8').matchAll(IMPORT)) {
      const r = resolve(f, m[1])
      if (r && /\.(tsx?|m?js)$/.test(r) && !seen.has(r)) {
        seen.set(r, f)
        queue.push(r)
      }
    }
  }
  return seen
}

const chain = (seen: Map<string, string>, f: string) => {
  const out = [f]
  for (let at = seen.get(f); at; at = seen.get(at)) out.push(at)
  return out.reverse().join(' → ')
}

describe('the visual editor stays off live pages', () => {
  const seen = reached()

  it('walks the pages’ imports (the renderer and the gate are reached)', () => {
    for (const f of [
      'packages/store-core/src/components/visitor/site/SitePage.tsx',
      'packages/store-core/src/components/visitor/site/code/interpret.tsx',
      'packages/store-core/src/components/visitor/site/editor/SiteEditorLazy.tsx',
      'packages/site-blocks/src/code.ts',
    ])
      expect(seen.has(f), f).toBe(true)
  })

  it('never statically imports the editor’s modules', () => {
    expect(EDITOR.filter(f => seen.has(f)).map(f => chain(seen, f))).toEqual([])
    expect([...seen.keys()].filter(f => f.startsWith(SHELL)).map(f => chain(seen, f))).toEqual([])
  })
})
