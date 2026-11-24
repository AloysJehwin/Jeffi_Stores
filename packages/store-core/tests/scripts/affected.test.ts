import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

// scripts/affected.mjs and scripts/component-owners.mjs drive the CI matrix. The root is process.cwd(), as in
// controller-service/tests/lib/tenant-migrations-schema-files.test.ts.
const root = process.cwd()
const load = async (name: string) => import(/* @vite-ignore */ pathToFileURL(path.join(root, 'scripts', name)).href)

const APPS = ['controller', 'storefront', 'admin', 'business', 'showcase']
const owners = {
  files: {
    'packages/store-core/src/components/visitor/Hero.tsx': ['storefront', 'business'],
    'packages/store-core/src/components/admin/Table.tsx': ['controller', 'admin'],
    'packages/store-core/src/lib/dead.ts': [],
  },
}
const pkgDependents = {
  'packages/wallet': { apps: ['storefront'], services: ['messaging', 'public-api'] },
  'packages/gst': { apps: [], services: ['documents'] },
}
const run = async (files: string[]) => (await load('affected.mjs')).affected(files, { owners, pkgDependents })

describe('affected', () => {
  it('maps an app change to that app only', async () => {
    expect(await run(['business-service/src/app/page.tsx'])).toEqual({ apps: ['business'], services: [], all: false })
    expect(await run(['admin-service/integration-tests/ui/a.test.tsx'])).toEqual({ apps: ['admin'], services: [], all: false })
  })
  it('maps a store-core component through the owners manifest', async () => {
    expect(await run(['packages/store-core/src/components/visitor/Hero.tsx'])).toEqual({
      apps: ['storefront', 'business'],
      services: ['store-core'],
      all: false,
    })
    expect((await run(['packages/store-core/src/components/admin/Table.tsx'])).apps).toEqual(['controller', 'admin'])
  })
  it('a dead store-core file or a store-core test touches store-core only', async () => {
    expect(await run(['packages/store-core/src/lib/dead.ts'])).toEqual({ apps: [], services: ['store-core'], all: false })
    expect(await run(['packages/store-core/tests/lib/x.test.ts'])).toEqual({ apps: [], services: ['store-core'], all: false })
  })
  it('treats a store-core file missing from the manifest as everything', async () => {
    const r = await run(['packages/store-core/src/components/visitor/Brand.tsx'])
    expect(r.all).toBe(true)
    expect(r.apps).toEqual(APPS)
  })
  it('maps other packages to their dependents, and an unknown package to everything', async () => {
    expect(await run(['packages/wallet/src/index.ts'])).toEqual({ apps: ['storefront'], services: ['messaging', 'public-api'], all: false })
    expect(await run(['packages/gst/src/index.ts'])).toEqual({ apps: [], services: ['documents'], all: false })
    expect((await run(['packages/new-pkg/src/index.ts'])).all).toBe(true)
  })
  it('maps each Fastify service and the ai-platform folders', async () => {
    expect((await run(['messaging-service/src/x.ts'])).services).toEqual(['messaging'])
    expect((await run(['document-service/src/x.ts'])).services).toEqual(['documents'])
    expect((await run(['ai-platform/paddleocr/ocr_service.py'])).services).toEqual(['ocr'])
    expect((await run(['ai-platform/gateway/src/x.ts'])).services).toEqual(['ai-gateway'])
    expect(await run(['mobile-service/client/app/index.tsx'])).toEqual({ apps: [], services: [], all: false })
  })
  it('a database file also marks every app, since each loads the schema', async () => {
    expect(await run(['messaging-service/database/tables/x.sql'])).toEqual({ apps: APPS, services: ['messaging'], all: false })
    expect((await run(['admin-service/database/indexes.sql'])).apps).toEqual(APPS)
  })
  it.each([
    '.github/workflows/ci.yml',
    '.github/actions/node-setup/action.yml',
    'package-lock.json',
    'package.json',
    'tsconfig.json',
    'vitest.config.ts',
    'vitest.db.config.ts',
    'playwright.ui.config.ts',
    'tests/ui-kit/visible.ts',
    'scripts/db-files.mjs',
    'scripts/component-owners.json',
    'something-new-at-the-root.cfg',
  ])('%s means everything', async (f) => {
    const r = await run([f])
    expect(r.all).toBe(true)
    expect(r.apps).toEqual(APPS)
    expect(r.services).toContain('ocr')
  })
  it.each(['docs/plans/X.md', 'README.md', 'graphify-out/graph.json', 'deploy/k8s/bootstrap/smoke.sh', 'scripts/check-route-tests.mjs', '.github/CODEOWNERS', 'tests/post-deploy/storefront.spec.ts'])(
    '%s needs no matrix job',
    async (f) => {
      expect(await run([f])).toEqual({ apps: [], services: [], all: false })
    },
  )
  it('unions several files, in a stable order', async () => {
    const r = await run(['storefront-service/src/a.ts', 'admin-service/src/b.ts', 'document-service/src/c.ts', 'docs/x.md'])
    expect(r).toEqual({ apps: ['storefront', 'admin'], services: ['documents'], all: false })
  })
  it('the CLI prints the contract JSON for a diff range', () => {
    const out = execFileSync('node', [path.join(root, 'scripts/affected.mjs'), 'HEAD', 'HEAD'], { encoding: 'utf8' })
    expect(JSON.parse(out)).toEqual({ apps: [], services: [], all: false })
  })
})

describe('packageDependents', () => {
  it('covers every package and follows package.json deps transitively', async () => {
    const dep = (await load('affected.mjs')).packageDependents(root)
    const dirs = fs.readdirSync(path.join(root, 'packages')).filter(d => fs.existsSync(path.join(root, 'packages', d, 'package.json')))
    for (const d of dirs) expect(dep[`packages/${d}`]).toBeDefined()
    // wallet lists @jeffi/tenancy, so tenancy reaches every service wallet does.
    for (const s of dep['packages/wallet'].services) expect(dep['packages/tenancy'].services).toContain(s)
  })
})

describe('component-owners', () => {
  it('the committed scripts/component-owners.json is current', async () => {
    const m = await load('component-owners.mjs')
    const committed = fs.readFileSync(path.join(root, 'scripts/component-owners.json'), 'utf8')
    expect(m.serialize(m.computeOwners(root))).toBe(committed)
  }, 60_000)
  it('lists store-core code files with owners drawn from the five apps', () => {
    const j = JSON.parse(fs.readFileSync(path.join(root, 'scripts/component-owners.json'), 'utf8'))
    const files = Object.entries(j.files) as [string, string[]][]
    expect(files.length).toBeGreaterThan(500)
    for (const [f, a] of files) {
      expect(f.startsWith('packages/store-core/src/')).toBe(true)
      for (const app of a) expect(APPS).toContain(app)
    }
    expect(files.some(([, a]) => a.length === APPS.length)).toBe(true)
  })
})
