#!/usr/bin/env node
// Which apps and services a change touches, for the CI matrix.
//   node scripts/affected.mjs <base> <head>  ->  {"apps":[...],"services":[...],"all":bool}
// apps: Next apps (controller storefront admin business showcase). services: messaging documents public-api
// mobile ai-gateway ocr, plus store-core when its own tests are affected. A path this does not recognise means
// everything, so a new top-level file can never silently skip a job (the nightly full run is the second net).
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const NEXT_APPS = ['controller', 'storefront', 'admin', 'business', 'showcase']
export const SERVICES = ['messaging', 'documents', 'public-api', 'mobile', 'ai-gateway', 'ocr', 'store-core']
const FASTIFY = { 'messaging-service': 'messaging', 'document-service': 'documents', 'public-api-service': 'public-api', 'mobile-service': 'mobile' }

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Paths that never need a job beyond the always-on ones (docs, graph, tooling, deploy scripts, release-only tests).
const IGNORE = [/^docs\//, /\.md$/, /^graphify-out\//, /^\.claude\//, /^oss\//, /^deploy\//, /^tests\/post-deploy\//, /^tests\/responsive\//, /^mobile-service\/client\//, /^LICENSE/, /^\.github\/(?!workflows\/ci\.yml$|actions\/)/, /^\.gitignore$/]
// Paths every job depends on.
const ALL = [/^\.github\/(workflows\/ci\.yml|actions\/)/, /^package(-lock)?\.json$/, /^tsconfig/, /^vitest/, /^playwright/, /^tests\/ui-kit\//, /^scripts\/(db-files\.mjs|seed-test-db\.sql|setup-test-db\.sh|dev-router\.ts|affected\.mjs|component-owners\.(mjs|json))$/]

/**
 * @param {string[]} files changed paths, repo-relative
 * @param {{ owners: { files: Record<string,string[]> }, pkgDependents: Record<string,{apps:string[],services:string[]}> }} ctx
 */
export function affected(files, ctx) {
  const apps = new Set()
  const services = new Set()
  let all = false
  const everyApp = () => NEXT_APPS.forEach((a) => apps.add(a))
  for (const raw of files) {
    const f = raw.split(path.sep).join('/')
    if (ALL.some((r) => r.test(f))) { all = true; continue }
    if (IGNORE.some((r) => r.test(f))) continue
    let m
    if ((m = f.match(/^packages\/store-core\/(.*)$/))) {
      services.add('store-core')
      if (/^(tests|integration-tests)\//.test(m[1])) continue // tests only affect store-core's own jobs
      const owners = ctx.owners.files[f]
      if (!owners) all = true // not in the manifest: assets, configs, a new file
      else owners.forEach((a) => apps.add(a))
    } else if ((m = f.match(/^packages\/([^/]+)\//))) {
      const d = ctx.pkgDependents[`packages/${m[1]}`]
      if (!d) all = true
      else {
        d.apps.forEach((a) => apps.add(a))
        d.services.forEach((s) => services.add(s))
      }
    } else if ((m = f.match(/^(controller|storefront|admin|business|showcase)-service\/(.*)$/))) {
      apps.add(m[1])
      if (m[2].startsWith('database/')) everyApp() // every app's API tests load the schema
    } else if ((m = f.match(/^(messaging|document|public-api|mobile)-service\/(.*)$/))) {
      services.add(FASTIFY[`${m[1]}-service`])
      if (m[2].startsWith('database/')) everyApp()
    } else if (/^ai-platform\/paddleocr\//.test(f)) services.add('ocr')
    else if (/^ai-platform\//.test(f)) services.add('ai-gateway')
    else if (/^scripts\//.test(f)) continue // the ratchet and check scripts run in the always-on cards
    else all = true
  }
  if (all) {
    everyApp()
    SERVICES.forEach((s) => services.add(s))
  }
  return { apps: NEXT_APPS.filter((a) => apps.has(a)), services: SERVICES.filter((s) => services.has(s)), all }
}

// Which apps and services reach each package: its own deps (transitively) and a scan of what imports it.
export function packageDependents(root = rootDir) {
  const pkgDirs = fs.readdirSync(path.join(root, 'packages')).filter((d) => fs.existsSync(path.join(root, 'packages', d, 'package.json')))
  const nameOf = {}
  const pkgDeps = {}
  for (const d of pkgDirs) {
    const j = JSON.parse(fs.readFileSync(path.join(root, 'packages', d, 'package.json'), 'utf8'))
    nameOf[d] = j.name
    pkgDeps[d] = Object.keys({ ...j.dependencies, ...j.devDependencies })
  }
  const dirOf = Object.fromEntries(Object.entries(nameOf).map(([d, n]) => [n, d]))
  const textOf = (dir) => {
    let out = ''
    const walk = (p) => {
      if (!fs.existsSync(p)) return
      for (const e of fs.readdirSync(p, { withFileTypes: true })) {
        if (['node_modules', '.next', 'tests', 'integration-tests', 'ui-tests', 'database', 'assets', 'public'].includes(e.name)) continue
        const q = path.join(p, e.name)
        if (e.isDirectory()) walk(q)
        else if (/\.(m?[jt]sx?|json)$/.test(e.name)) out += fs.readFileSync(q, 'utf8')
      }
    }
    walk(path.join(root, dir))
    return out
  }
  // direct consumers per package name
  const direct = {}
  const add = (name, kind, v) => ((direct[name] ??= { apps: new Set(), services: new Set() })[kind].add(v))
  const coreText = textOf('packages/store-core')
  const appText = Object.fromEntries(NEXT_APPS.map((a) => [a, textOf(`${a}-service`)]))
  for (const n of Object.keys(dirOf)) {
    for (const a of NEXT_APPS) if (coreText.includes(n) || appText[a].includes(n)) add(n, 'apps', a)
  }
  for (const [dir, svc] of Object.entries(FASTIFY)) {
    const j = JSON.parse(fs.readFileSync(path.join(root, dir, 'package.json'), 'utf8'))
    for (const n of Object.keys({ ...j.dependencies, ...j.devDependencies })) if (dirOf[n]) add(n, 'services', svc)
  }
  const out = {}
  for (const d of pkgDirs) {
    const apps = new Set()
    const services = new Set()
    const seen = new Set()
    const visit = (name) => {
      if (seen.has(name)) return
      seen.add(name)
      direct[name]?.apps.forEach((a) => apps.add(a))
      direct[name]?.services.forEach((s) => services.add(s))
      for (const [od, deps] of Object.entries(pkgDeps)) if (deps.includes(name)) visit(nameOf[od])
    }
    visit(nameOf[d])
    out[`packages/${d}`] = { apps: [...apps], services: [...services] }
  }
  return out
}

function main() {
  const [base, head] = process.argv.slice(2)
  if (!base || !head) {
    console.error('usage: node scripts/affected.mjs <base> <head>')
    process.exit(2)
  }
  const files = execFileSync('git', ['diff', '--name-only', base, head], { cwd: rootDir, encoding: 'utf8' }).split('\n').filter(Boolean)
  const owners = JSON.parse(fs.readFileSync(path.join(rootDir, 'scripts/component-owners.json'), 'utf8'))
  console.log(JSON.stringify(affected(files, { owners, pkgDependents: packageDependents() })))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
