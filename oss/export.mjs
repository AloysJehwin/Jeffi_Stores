#!/usr/bin/env node
// Exports Jeffi_Stores to the Jeffi-ERP org: one repo per service (oss/repos.json) plus the org's .github repo.
//
//   node oss/export.mjs --init [--upstream <rev>] [--only a,b]   first import: one snapshot commit per empty repo
//   node oss/export.mjs [--upstream <rev>] [--only a,b] [--dry-run]   apply what changed since each repo's last export
//
// Env: GH_TOKEN (push to the org repos, open issues), OSS_BOT_NAME / OSS_BOT_EMAIL (commit identity in CI).
// Every export commit carries "Upstream-Commit: <sha>": the org repos' merge pipeline skips those commits, and the
// next export diffs from that sha. Changes apply 3-way, so contributions merged in the org but not yet promoted
// survive; a conflict stops that repo and opens an issue there. Files under oss/templates and oss/workspace are
// "managed": rewritten on every export (the org's PR gate refuses changes to them). Every changed file is scanned
// with trufflehog before anything is pushed; findings not listed in oss/secret-scan-allow.txt stop that repo.
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const mono = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: here, encoding: 'utf8' }).trim()
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'repos.json'), 'utf8'))
const ORG_REPO = '.github'

const opts = { init: false, upstream: 'HEAD', only: null, dryRun: false, keep: false }
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--init') opts.init = true
  else if (a === '--dry-run') opts.dryRun = true
  else if (a === '--keep') opts.keep = true
  else if (a === '--upstream') opts.upstream = argv[++i]
  else if (a === '--only') opts.only = (argv[++i] || '').split(',').map(s => s.trim()).filter(Boolean)
  else throw new Error(`unknown option ${a}`)
}
if (opts.only && !opts.only.length) opts.only = null

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || ''
const run = (cmd, args, { cwd = mono, input, env, binary = false, allowFail = false } = {}) => {
  const res = spawnSync(cmd, args, { cwd, input, env: { ...process.env, ...env }, maxBuffer: 1 << 30, encoding: binary ? 'buffer' : 'utf8' })
  if (res.status !== 0 && !allowFail) {
    const err = (binary ? res.stderr?.toString() : res.stderr) || res.error?.message || ''
    throw Object.assign(new Error(`${cmd} ${args.join(' ')} (in ${cwd}): ${err.trim()}`), { stderr: err, status: res.status })
  }
  return allowFail ? res : res.stdout
}
const monoGit = (args, o = {}) => run('git', args, { cwd: mono, ...o })
// Org-repo git calls get the token as a header through the environment (never in a URL or on disk).
const auth = token ? {
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
  GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`,
} : {}
const identity = process.env.OSS_BOT_NAME ? {
  GIT_AUTHOR_NAME: process.env.OSS_BOT_NAME, GIT_AUTHOR_EMAIL: process.env.OSS_BOT_EMAIL,
  GIT_COMMITTER_NAME: process.env.OSS_BOT_NAME, GIT_COMMITTER_EMAIL: process.env.OSS_BOT_EMAIL,
} : {}
const orgGit = (dir, args, o = {}) => run('git', args, { cwd: dir, ...o, env: { ...auth, ...identity, ...o.env } })

async function api(method, url, body) {
  const res = await fetch(`https://api.github.com${url}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'jeffi-erp-export' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) throw Object.assign(new Error(`${method} ${url}: ${res.status} ${data?.message ?? text}`), { status: res.status })
  return data
}

const U1 = monoGit(['rev-parse', '--verify', `${opts.upstream}^{commit}`]).trim()
const U1s = U1.slice(0, 7)
const upstreamUrl = `https://github.com/${manifest.upstream.repo}`

// ── What goes where ──────────────────────────────────────────────────────────────────────────────

const managedOf = r => [...manifest.managed, ...(r.managed ?? [])]
function specs(r) {
  if (!r.path) return [...r.include, ...(r.exclude ?? []).map(e => `:(exclude)${e}`)]
  return [`${r.path}/`, ...[...(r.exclude ?? []), ...managedOf(r)].map(e => `:(exclude)${r.path}/${e.replace(/\/$/, '')}`)]
}
const exportsReadme = r => !!r.path && run('git', ['cat-file', '-e', `${U1}:${r.path}/README.md`], { allowFail: true }).status === 0

function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, base, out)
    else out.push(path.relative(base, p))
  }
  return out
}

function checksTable(r) {
  const rows = []
  for (const [stage, label] of [['pr', 'PR checks (after `ok-to-test`)'], ['prebuild', 'Pre-build (after merge)'], ['build', 'Build (after merge)']]) {
    for (const s of r.checks[stage]) rows.push(`| ${label} | ${s.name} | \`${s.run}\` |`)
  }
  return ['| Stage | Check | Command (from the workspace root) |', '|---|---|---|', ...rows].join('\n')
}

function render(text, r) {
  const vars = {
    org: manifest.org, repo: r.name, path: r.path || '.', description: r.description ?? '', upstream: manifest.upstream.repo,
    upstream_owner: manifest.upstream.repo.split('/')[0], upstream_name: manifest.upstream.repo.split('/')[1], base: manifest.promote.base,
    label: manifest.label, owner: manifest.owner, maintainers: manifest.maintainers, checks: r.checks ? checksTable(r) : '',
    folder: r.path ? `\`${r.path}/\`` : 'the workspace root',
  }
  return text.replace(/%%(\w+)%%/g, (m, k) => (k in vars ? vars[k] : m))
}

// Managed files for a repo: path → contents. Rendered from this checkout's oss/ (the same commit in CI).
function managedFiles(r) {
  const files = new Map()
  if (r.name === ORG_REPO) {
    const dir = path.join(here, 'templates', 'org')
    for (const f of walk(dir)) files.set(f.split(path.sep).join('/'), fs.readFileSync(path.join(dir, f)))
    return files
  }
  files.set('LICENSE', monoGit(['show', `${U1}:LICENSE`], { binary: true }))
  const repoDir = path.join(here, 'templates', 'repo')
  for (const f of walk(repoDir)) {
    const rel = f.split(path.sep).join('/')
    if (rel === '.github/README.md' && exportsReadme(r)) continue
    files.set(rel, render(fs.readFileSync(path.join(repoDir, f), 'utf8'), r))
  }
  if (r.name === 'workspace') {
    const ws = path.join(here, 'workspace')
    for (const f of walk(ws)) files.set(`oss/${f.split(path.sep).join('/')}`, fs.readFileSync(path.join(ws, f)))
    files.set('oss/repos.json', fs.readFileSync(path.join(here, 'repos.json')))
  }
  const list = [...files.keys(), '.github/managed-files.txt'].sort()
  files.set('.github/managed-files.txt', `# Written by the export from ${manifest.upstream.repo}; edits are overwritten. Change them there (oss/).\n${list.join('\n')}\n`)
  return files
}

function writeManaged(dir, r) {
  const files = managedFiles(r)
  const tracked = orgGit(dir, ['ls-files', '-z']).split('\0').filter(Boolean)
  let stale = []
  if (r.name === ORG_REPO) stale = tracked.filter(f => !files.has(f))
  else if (tracked.includes('.github/managed-files.txt')) {
    stale = fs.readFileSync(path.join(dir, '.github/managed-files.txt'), 'utf8').split('\n').filter(l => l && !l.startsWith('#') && !files.has(l))
  }
  stale = stale.filter(f => tracked.includes(f))
  for (const f of stale) fs.rmSync(path.join(dir, f), { force: true })
  for (const [f, body] of files) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true })
    fs.writeFileSync(path.join(dir, f), body)
    if (f.endsWith('.mjs') || f.endsWith('.sh')) fs.chmodSync(path.join(dir, f), 0o755)
  }
  orgGit(dir, ['add', '-A', '--force', '--', ...files.keys(), ...stale], { env: { GIT_LITERAL_PATHSPECS: '1' } })
}

// ── Secret scan ──────────────────────────────────────────────────────────────────────────────────

const allow = fs.readFileSync(path.join(here, 'secret-scan-allow.txt'), 'utf8').split('\n')
  .map(l => l.replace(/#.*/, '').trim()).filter(Boolean).map(l => l.split(/\s+/))
function scan(r, dir, files) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `scan-${r.name}-`))
  try {
    let n = 0
    for (const f of files) {
      const from = path.join(dir, f)
      if (!fs.existsSync(from) || fs.lstatSync(from).isSymbolicLink()) continue
      fs.mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true })
      fs.copyFileSync(from, path.join(tmp, f))
      n++
    }
    if (!n) return []
    const out = run(process.env.TRUFFLEHOG || 'trufflehog', ['filesystem', tmp, '--json', '--no-update', '--results=verified,unknown,unverified'], { cwd: tmp })
    const findings = out.split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l)).map(j => ({
      detector: j.DetectorName,
      verified: j.Verified,
      file: path.relative(tmp, j.SourceMetadata?.Data?.Filesystem?.file ?? ''),
      line: j.SourceMetadata?.Data?.Filesystem?.line,
    }))
    return findings.filter(f => !allow.some(([d, p]) => d === f.detector && p === `${r.name}:${f.file}`))
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

// ── One repo ─────────────────────────────────────────────────────────────────────────────────────

function lastUpstream(dir) {
  const log = orgGit(dir, ['log', '--format=%(trailers:key=Upstream-Commit,valueonly,separator=%x20)', 'origin/main'])
  return log.split('\n').map(s => s.trim()).find(Boolean) || null
}

function ensureMonoCommit(sha) {
  if (run('git', ['cat-file', '-e', `${sha}^{commit}`], { allowFail: true }).status === 0) return
  monoGit(['fetch', '--quiet', '--no-tags', '--depth=1', 'origin', sha])
}

function snapshot(r, dir) {
  if (r.name === ORG_REPO) return
  const args = r.path
    ? ['archive', '--format=tar', `${U1}:${r.path}`, '--', '.', ...[...(r.exclude ?? []), ...managedOf(r)].map(e => `:(exclude)${e.replace(/\/$/, '')}`)]
    : ['archive', '--format=tar', U1, '--', ...specs(r)]
  run('tar', ['-x', '-C', dir], { input: monoGit(args, { binary: true }), binary: true })
}

// Which upstream changes still need applying: drops files the org repo already has in their new state
// (promoted contributions coming back), so only real differences reach the 3-way apply.
function pendingChanges(r, U0, dir) {
  const rel = r.path ? [`--relative=${r.path}/`] : []
  const raw = monoGit(['diff', '--raw', '-z', '--no-renames', '--full-index', '--no-abbrev', ...rel, U0, U1, '--', ...specs(r)])
  const parts = raw.split('\0')
  const entries = []
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const m = parts[i].match(/^:(\d+) (\d+) ([0-9a-f]+) ([0-9a-f]+) ([A-Z])/)
    if (m) entries.push({ srcMode: m[1], dstMode: m[2], src: m[3], dst: m[4], status: m[5], path: parts[i + 1] })
  }
  const tree = new Map()
  for (const line of orgGit(dir, ['ls-tree', '-r', '-z', '--full-tree', 'HEAD']).split('\0').filter(Boolean)) {
    const [meta, p] = line.split('\t')
    const [mode, , oid] = meta.split(' ')
    tree.set(p, { mode, oid })
  }
  return entries.filter(e => {
    const have = tree.get(e.path)
    if (e.status === 'D') return !!have
    return !have || have.oid !== e.dst || have.mode !== e.dstMode
  })
}

async function conflictIssue(r, U0, detail, files) {
  if (opts.dryRun || !token) return
  const title = 'Export from Jeffi_Stores conflicts with unpromoted changes'
  const body = [
    `The export of [${manifest.upstream.repo}@${U1s}](${upstreamUrl}/commit/${U1}) didn't apply here: it changes lines that a merged contribution here also changed, and that contribution isn't in ${manifest.upstream.repo} yet.`,
    `Upstream range: ${upstreamUrl}/compare/${U0}...${U1}`,
    files.length ? `\nFiles:\n${files.map(f => `- \`${f}\``).join('\n')}` : '',
    `\n\`\`\`\n${detail.slice(0, 3000)}\n\`\`\``,
    '\nTo fix: promote the pending change (its merge pipeline approval), or resolve it by hand, then re-run **OSS export** in Jeffi_Stores (Actions → OSS export → Run workflow). Nothing was pushed here.',
  ].join('\n')
  const open = await api('GET', `/repos/${manifest.org}/${r.name}/issues?state=open&labels=sync-conflict&per_page=20`)
  const same = open.find(i => i.title === title)
  if (same) await api('POST', `/repos/${manifest.org}/${r.name}/issues/${same.number}/comments`, { body })
  else await api('POST', `/repos/${manifest.org}/${r.name}/issues`, { title, body, labels: ['sync-conflict'] })
}

async function exportRepo(r, workdir) {
  const dir = path.join(workdir, r.name)
  fs.rmSync(dir, { recursive: true, force: true })
  // OSS_ORG_URL points at local bare repos when testing the export without GitHub.
  const url = process.env.OSS_ORG_URL ? `${process.env.OSS_ORG_URL}/${r.name}.git` : `https://github.com/${manifest.org}/${r.name}.git`
  orgGit(workdir, ['clone', '--quiet', ...(process.env.OSS_ORG_URL ? [] : ['--filter=blob:none']), url, dir])
  const hasMain = orgGit(dir, ['rev-parse', '--verify', '--quiet', 'origin/main'], { allowFail: true }).status === 0

  let U0 = null
  let message
  if (opts.init) {
    if (hasMain) return { status: 'skipped', note: 'already imported' }
    orgGit(dir, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
    snapshot(r, dir)
    writeManaged(dir, r)
    // --force: Jeffi_Stores tracks some files its own .gitignore matches (scripts/*), and they must come along.
    orgGit(dir, ['add', '-A', '--force'])
    message = [
      `chore: import from ${manifest.upstream.repo}@${U1s}`,
      '',
      r.name === ORG_REPO
        ? `Org community files, exported from ${manifest.upstream.repo} (oss/templates/org).`
        : `Snapshot of ${r.path ? `${r.path}/` : 'the workspace root files'} at ${manifest.upstream.repo}@${U1s}, without its history.`,
      '',
      `Upstream-Commit: ${U1}`,
    ].join('\n')
  } else {
    if (!hasMain) return { status: 'failed', note: 'not imported yet; run with --init' }
    orgGit(dir, ['checkout', '--quiet', 'main'])
    U0 = lastUpstream(dir)
    if (!U0) return { status: 'failed', note: 'no Upstream-Commit trailer on main' }
    let upstreamChanged = false
    if (r.name !== ORG_REPO && U0 !== U1) {
      ensureMonoCommit(U0)
      upstreamChanged = run('git', ['diff', '--quiet', U0, U1, '--', ...specs(r)], { allowFail: true }).status === 1
    }
    if (upstreamChanged) {
      const pending = pendingChanges(r, U0, dir)
      if (pending.length) {
        for (const e of pending) {
          if (/^0+$/.test(e.src)) continue
          orgGit(dir, ['hash-object', '-w', '--stdin'], { input: monoGit(['cat-file', 'blob', e.src], { binary: true }) })
        }
        const files = pending.map(e => (r.path ? `${r.path}/${e.path}` : e.path))
        const patch = monoGit(['diff', '--binary', '--full-index', '--no-renames', ...(r.path ? [`--relative=${r.path}/`] : []), U0, U1, '--', ...files], { env: { GIT_LITERAL_PATHSPECS: '1' } })
        const patchFile = path.join(workdir, `${r.name}.patch`)
        fs.writeFileSync(patchFile, patch)
        const res = orgGit(dir, ['apply', '--3way', '--index', '--whitespace=nowarn', patchFile], { allowFail: true })
        if (res.status !== 0) {
          const conflicted = orgGit(dir, ['diff', '--name-only', '--diff-filter=U']).split('\n').filter(Boolean)
          await conflictIssue(r, U0, `${res.stderr}`.trim(), conflicted.length ? conflicted : pending.map(e => e.path))
          return { status: 'conflict', note: conflicted.join(', ') || `${res.stderr}`.trim().split('\n')[0] }
        }
      }
    }
    writeManaged(dir, r)
    const staged = orgGit(dir, ['diff', '--cached', '--name-only']).split('\n').filter(Boolean)
    if (!staged.length && !upstreamChanged) return { status: 'unchanged' }
    const subject = U0 !== U1 ? monoGit(['log', '-1', '--format=%s', U1]).trim() : 'managed files'
    message = [
      r.name === ORG_REPO ? `chore(sync): community files from ${manifest.upstream.repo}@${U1s}` : `chore(sync): ${manifest.upstream.repo}@${U1s}${staged.length ? '' : ' (already here)'}`,
      '',
      `${subject}`,
      U0 !== U1 ? `${upstreamUrl}/compare/${U0.slice(0, 12)}...${U1.slice(0, 12)}` : '',
      '',
      `Upstream-Commit: ${U1}`,
    ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n')
  }

  const staged = orgGit(dir, ['diff', '--cached', '--name-only', '-z', '--diff-filter=d']).split('\0').filter(Boolean)
  const findings = scan(r, dir, staged)
  if (findings.length) {
    return { status: 'blocked', note: `secret scan: ${findings.map(f => `${f.detector} ${f.file}:${f.line}${f.verified ? ' (verified)' : ''}`).join('; ')}` }
  }
  const stat = orgGit(dir, ['diff', '--cached', '--shortstat']).trim() || 'no file changes'
  orgGit(dir, ['commit', '--quiet', '--allow-empty', '-F', '-'], { input: message })
  if (opts.dryRun) return { status: 'would push', note: stat }
  orgGit(dir, ['push', '--quiet', 'origin', 'HEAD:refs/heads/main'])
  return { status: opts.init ? 'imported' : 'exported', note: stat }
}

// ── Main ─────────────────────────────────────────────────────────────────────────────────────────

const targets = [...manifest.repos, { name: ORG_REPO }]
const unknown = (opts.only ?? []).filter(n => !targets.some(t => t.name === n))
if (unknown.length) throw new Error(`not in repos.json: ${unknown.join(', ')}`)
const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-export-'))
const results = []
for (const r of targets.filter(t => !opts.only || opts.only.includes(t.name))) {
  let result
  for (let attempt = 1; ; attempt++) {
    try {
      result = await exportRepo(r, workdir)
      break
    } catch (e) {
      const raced = /\[rejected\]|non-fast-forward|fetch first/.test(e.message)
      if (raced && attempt < 3) continue
      result = { status: 'failed', note: e.message.split('\n').slice(0, 3).join(' ') }
      break
    }
  }
  results.push({ repo: r.name, ...result })
  console.log(`${r.name.padEnd(20)} ${result.status}${result.note ? `  ${result.note}` : ''}`)
}
if (!opts.keep) fs.rmSync(workdir, { recursive: true, force: true })
else console.log(`kept ${workdir}`)

const table = ['| Repo | Result | Detail |', '|---|---|---|', ...results.map(x => `| ${x.repo} | ${x.status} | ${(x.note ?? '').replace(/\|/g, '\\|')} |`)].join('\n')
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Export of ${manifest.upstream.repo}@${U1s}\n\n${table}\n`)
if (results.some(x => ['failed', 'conflict', 'blocked'].includes(x.status))) process.exit(1)
