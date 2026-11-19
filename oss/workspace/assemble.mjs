#!/usr/bin/env node
// Clones every Jeffi ERP repo into its folder, so this checkout matches the Jeffi_Stores layout
// (admin-service/, packages/, packages/store-core/, ...). Managed from Jeffi_Stores (oss/workspace/).
//
//   node oss/assemble.mjs                       full clones next to this workspace
//   node oss/assemble.mjs --ssh                 clone over SSH
//   node oss/assemble.mjs --shallow             depth-1 clones (CI)
//   node oss/assemble.mjs --place admin-service=../pr   move an existing checkout into place instead of cloning it
//   node oss/assemble.mjs --skip packages       leave one repo out
//   node oss/assemble.mjs --ref admin-service=<sha>     check out a commit instead of main
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'repos.json'), 'utf8'))

const opts = { root: path.join(here, '..'), shallow: false, ssh: false, place: {}, ref: {}, skip: new Set() }
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  const next = () => {
    if (i + 1 >= argv.length) throw new Error(`${a} needs a value`)
    return argv[++i]
  }
  const pair = () => {
    const [k, v] = next().split('=')
    if (!k || !v) throw new Error(`${a} expects <repo>=<value>`)
    return [k, v]
  }
  if (a === '--root') opts.root = path.resolve(next())
  else if (a === '--shallow') opts.shallow = true
  else if (a === '--ssh') opts.ssh = true
  else if (a === '--skip') opts.skip.add(next())
  else if (a === '--place') { const [k, v] = pair(); opts.place[k] = path.resolve(v) }
  else if (a === '--ref') { const [k, v] = pair(); opts.ref[k] = v }
  else if (a === '-h' || a === '--help') { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 11).join('\n')); process.exit(0) }
  else throw new Error(`unknown option ${a}`)
}

const git = (args, cwd) => execFileSync('git', args, { cwd, stdio: ['ignore', 'inherit', 'inherit'] })
const known = new Set(manifest.repos.map(r => r.name))
for (const name of [...Object.keys(opts.place), ...Object.keys(opts.ref), ...opts.skip]) {
  if (!known.has(name)) throw new Error(`no repo named ${name} in repos.json`)
}

// Parents before children: packages/ must exist before packages/store-core/ goes into it.
const repos = manifest.repos.filter(r => r.path).sort((a, b) => a.path.split('/').length - b.path.split('/').length)

for (const r of repos) {
  const dest = path.join(opts.root, r.path)
  if (opts.skip.has(r.name)) continue
  if (opts.place[r.name]) {
    if (fs.existsSync(dest)) throw new Error(`${r.path} already exists; can't place ${r.name} there`)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.renameSync(opts.place[r.name], dest)
    console.log(`placed  ${r.name} -> ${r.path}/`)
    continue
  }
  if (fs.existsSync(path.join(dest, '.git'))) {
    console.log(`exists  ${r.name} (${r.path}/)`)
    continue
  }
  if (fs.existsSync(dest) && fs.readdirSync(dest).length) throw new Error(`${r.path}/ exists and isn't a clone of ${r.name}`)
  const url = opts.ssh ? `git@github.com:${manifest.org}/${r.name}.git` : `https://github.com/${manifest.org}/${r.name}.git`
  const ref = opts.ref[r.name]
  git(['clone', '--quiet', ...(opts.shallow && !ref ? ['--depth', '1'] : []), ...(ref ? [] : ['--branch', 'main']), url, dest])
  if (ref) {
    git(['fetch', '--quiet', '--depth', '1', 'origin', ref], dest)
    git(['checkout', '--quiet', '--detach', 'FETCH_HEAD'], dest)
  }
  console.log(`cloned  ${r.name} -> ${r.path}/${ref ? ` @ ${ref}` : ''}`)
}

// Each checkout ignores the repos nested inside it (local .git/info/exclude, nothing committed).
const checkouts = [{ path: '' }, ...repos].filter(r => fs.existsSync(path.join(opts.root, r.path, '.git')))
for (const parent of checkouts) {
  const inside = repos.filter(r => r.path !== parent.path && (parent.path === '' || r.path.startsWith(`${parent.path}/`)))
    .map(r => `/${parent.path ? r.path.slice(parent.path.length + 1) : r.path}/`)
  if (!inside.length) continue
  const gitDir = path.join(opts.root, parent.path, '.git')
  const exclude = fs.statSync(gitDir).isDirectory()
    ? path.join(gitDir, 'info', 'exclude')
    : path.join(path.resolve(path.join(opts.root, parent.path), fs.readFileSync(gitDir, 'utf8').replace(/^gitdir:\s*/, '').trim()), 'info', 'exclude')
  fs.mkdirSync(path.dirname(exclude), { recursive: true })
  const have = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : ''
  const add = inside.filter(p => !have.split('\n').includes(p))
  if (add.length) fs.appendFileSync(exclude, `${have && !have.endsWith('\n') ? '\n' : ''}# nested Jeffi ERP repos (oss/assemble.mjs)\n${add.join('\n')}\n`)
}
