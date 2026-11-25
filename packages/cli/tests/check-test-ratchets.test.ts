import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawnSync } from 'child_process'

const repo = process.cwd()
const COMPONENT = path.join(repo, 'scripts/check-component-tests.mjs')
const ROUTE = path.join(repo, 'scripts/check-route-tests.mjs')

let root: string
const put = (rel: string, body = '') => {
  const f = path.join(root, rel)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, body)
}
const run = (script: string, ...args: string[]) => {
  const r = spawnSync('node', [script, '--root', root, ...args], { encoding: 'utf8' })
  return { code: r.status, out: `${r.stdout}${r.stderr}` }
}
const allowlist = (name: string, files: string[]) =>
  put(`scripts/${name}`, JSON.stringify({ owners: { x: files } }))
const readList = (name: string): string[] =>
  Object.values(JSON.parse(fs.readFileSync(path.join(root, 'scripts', name), 'utf8')).owners).flat() as string[]

const COMP = 'export function Widget() { return <div /> }\n'

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchet-'))
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

describe('check-component-tests', () => {
  const LIST = 'component-tests-allowlist.json'

  it('lists only real components and skips barrels, stories, hooks and constants', () => {
    put('packages/store-core/src/components/ui/Button.tsx', COMP)
    put('packages/store-core/src/components/ui/index.ts', "export { Button } from './Button'\n")
    put('packages/store-core/src/components/ui/index.tsx', "export * from './Button'\n")
    put('packages/store-core/src/components/ui/Button.stories.tsx', COMP)
    put('packages/store-core/src/components/ui/consts.tsx', "export const LABELS = ['a']\nexport type Props = {}\n")
    put('packages/store-core/src/components/ui/useThing.tsx', 'export function useThing() { return 1 }\n')
    put('packages/store-core/src/components/ui/Page.tsx', 'export default function () { return null }\n')
    put('admin-service/src/components/Nav.tsx', 'export const Nav = () => null\n')
    put('admin-service/src/app/x/XClient.tsx', 'export default function XClient() { return null }\n')
    put('admin-service/src/app/x/page.tsx', 'export default function Page() { return null }\n')
    expect(run(COMPONENT, '--init').code).toBe(0)
    expect(readList(LIST).sort()).toEqual([
      'admin-service/src/app/x/XClient.tsx',
      'admin-service/src/components/Nav.tsx',
      'packages/store-core/src/components/ui/Button.tsx',
      'packages/store-core/src/components/ui/Page.tsx',
    ])
  })

  it('passes when every untested component is allowlisted', () => {
    put('packages/store-core/src/components/Card.tsx', COMP)
    allowlist(LIST, ['packages/store-core/src/components/Card.tsx'])
    expect(run(COMPONENT).code).toBe(0)
  })

  it('fails on a new untested component', () => {
    put('packages/store-core/src/components/Card.tsx', COMP)
    allowlist(LIST, [])
    const r = run(COMPONENT)
    expect(r.code).toBe(1)
    expect(r.out).toContain('packages/store-core/src/components/Card.tsx')
    expect(r.out).toContain('not in scripts/component-tests-allowlist.json')
  })

  it('fails on an allowlisted component that now has a test, with the remove message', () => {
    put('packages/store-core/src/components/Card.tsx', COMP)
    put('packages/store-core/tests/components/Card.test.tsx', "import { Widget } from '@/components/Card'\n")
    allowlist(LIST, ['packages/store-core/src/components/Card.tsx'])
    const r = run(COMPONENT)
    expect(r.code).toBe(1)
    expect(r.out).toContain('remove them from scripts/component-tests-allowlist.json')
  })

  it('fails on an allowlisted component that no longer exists', () => {
    allowlist(LIST, ['packages/store-core/src/components/Gone.tsx'])
    const r = run(COMPONENT)
    expect(r.code).toBe(1)
    expect(r.out).toContain('no longer exist')
  })

  it('resolves @/, @<app>/ and relative imports, follows barrels, and ignores path tails', () => {
    put('packages/store-core/src/components/A.tsx', COMP)
    put('packages/store-core/src/components/B/index.tsx', "export { B } from './B'\n")
    put('packages/store-core/src/components/B/B.tsx', 'export function B() { return null }\n')
    put('storefront-service/src/components/C.tsx', COMP)
    put('storefront-service/src/components/D.tsx', COMP)
    put('storefront-service/src/components/E.tsx', COMP)
    put(
      'storefront-service/integration-tests/ui/all.test.tsx',
      [
        "import { Widget } from '@/components/A'",
        "import { B } from '@/components/B'",
        "import { Widget as C } from '@storefront/components/C'",
        "import { Widget as D } from '../../src/components/D'",
        // same tail as E but a different file: must not count
        "import x from '@/components/other/E'",
      ].join('\n'),
    )
    expect(run(COMPONENT, '--init').code).toBe(0)
    expect(readList(LIST)).toEqual(['storefront-service/src/components/E.tsx'])
  })

  it('does not count a component that a test only mocks, but counts real imports of every form', () => {
    for (const n of ['M1', 'M2', 'M3', 'I1', 'I2', 'I3', 'I4', 'I5']) put(`packages/store-core/src/components/${n}.tsx`, COMP)
    put(
      'packages/store-core/tests/mocks.test.tsx',
      [
        "vi.mock('@/components/M1', () => ({}))",
        "vi.doMock('@/components/M2', () => ({}))",
        "const m = await vi.importMock('@/components/M3')",
        "import X from '@/components/I1'",
        "import '@/components/I2'",
        "const a = await import('@/components/I3')",
        "const b = require('@/components/I4')",
        "const c = await vi.importActual('@/components/I5')",
      ].join('\n'),
    )
    expect(run(COMPONENT, '--init').code).toBe(0)
    expect(readList(LIST)).toEqual(['M1', 'M2', 'M3'].map((n) => `packages/store-core/src/components/${n}.tsx`))
  })

  it('--init refuses to overwrite and --prune only drops fixed entries', () => {
    put('packages/store-core/src/components/A.tsx', COMP)
    put('packages/store-core/src/components/B.tsx', COMP)
    put('packages/store-core/tests/B.test.tsx', "import '@/components/B'\n")
    allowlist(LIST, ['packages/store-core/src/components/A.tsx', 'packages/store-core/src/components/B.tsx', 'packages/store-core/src/components/Z.tsx'])
    expect(run(COMPONENT, '--init').code).toBe(1)
    expect(run(COMPONENT, '--prune').code).toBe(0)
    expect(readList(LIST)).toEqual(['packages/store-core/src/components/A.tsx'])
  })
})

describe('check-route-tests', () => {
  const LIST = 'route-tests-allowlist.json'
  const ROUTE_SRC = 'export async function GET() { return new Response("ok") }\n'

  it('covers route.ts and route.tsx in every Next app and ignores non-route files', () => {
    put('admin-service/src/app/api/(admin)/a/route.ts', ROUTE_SRC)
    put('controller-service/src/app/api/(ecom)/b/route.tsx', ROUTE_SRC)
    put('showcase-service/src/app/api/health/route.ts', ROUTE_SRC)
    put('admin-service/src/app/api/(admin)/a/helper.ts', 'export const x = 1\n')
    put('messaging-service/src/app/api/route.ts', ROUTE_SRC)
    expect(run(ROUTE, '--init').code).toBe(0)
    expect(readList(LIST)).toEqual([
      'admin-service/src/app/api/(admin)/a/route.ts',
      'controller-service/src/app/api/(ecom)/b/route.tsx',
      'showcase-service/src/app/api/health/route.ts',
    ])
  })

  it('fails on a new untested route and passes once it is allowlisted', () => {
    put('admin-service/src/app/api/(admin)/a/route.ts', ROUTE_SRC)
    allowlist(LIST, [])
    const r = run(ROUTE)
    expect(r.code).toBe(1)
    expect(r.out).toContain('admin-service/src/app/api/(admin)/a/route.ts')
    allowlist(LIST, ['admin-service/src/app/api/(admin)/a/route.ts'])
    expect(run(ROUTE).code).toBe(0)
  })

  it('counts a route as tested by an alias or relative import, and flags the stale allowlist entry', () => {
    put('admin-service/src/app/api/(admin)/a/route.ts', ROUTE_SRC)
    put('admin-service/src/app/api/(admin)/b/route.ts', ROUTE_SRC)
    put(
      'admin-service/tests/api/a.test.ts',
      "import { GET } from '@admin/app/api/(admin)/a/route'\nconst b = await import('../../src/app/api/(admin)/b/route')\n",
    )
    allowlist(LIST, ['admin-service/src/app/api/(admin)/a/route.ts', 'admin-service/src/app/api/(admin)/b/route.ts'])
    const r = run(ROUTE)
    expect(r.code).toBe(1)
    expect(r.out).toContain('remove them from scripts/route-tests-allowlist.json')
    expect(run(ROUTE, '--prune').code).toBe(0)
    expect(readList(LIST)).toEqual([])
    expect(run(ROUTE).code).toBe(0)
  })

  it('does not count a route that a test only mocks', () => {
    put('admin-service/src/app/api/(admin)/a/route.ts', ROUTE_SRC)
    put('admin-service/src/app/api/(admin)/b/route.ts', ROUTE_SRC)
    put(
      'admin-service/tests/api/x.test.ts',
      "vi.mock('@admin/app/api/(admin)/a/route', () => ({}))\nimport { GET } from '@admin/app/api/(admin)/b/route'\n",
    )
    expect(run(ROUTE, '--init').code).toBe(0)
    expect(readList(LIST)).toEqual(['admin-service/src/app/api/(admin)/a/route.ts'])
  })

  it('fails on an allowlisted route that no longer exists', () => {
    allowlist(LIST, ['admin-service/src/app/api/(admin)/gone/route.ts'])
    const r = run(ROUTE)
    expect(r.code).toBe(1)
    expect(r.out).toContain('no longer exist')
  })
})

describe('real tree', () => {
  it('passes both ratchets', () => {
    expect(spawnSync('node', [COMPONENT], { encoding: 'utf8' }).status).toBe(0)
    expect(spawnSync('node', [ROUTE], { encoding: 'utf8' }).status).toBe(0)
  })
})
