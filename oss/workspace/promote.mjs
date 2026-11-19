#!/usr/bin/env node
// Turns a commit merged into a Jeffi ERP repo into a pull request on Jeffi_Stores. Runs in the merge pipeline's
// approval job, after a maintainer approves. Managed from Jeffi_Stores (oss/workspace/).
//
//   node oss/promote.mjs --repo <name> --sha <merged sha> --src <org checkout, depth 2> --mono <Jeffi_Stores checkout> [--pr <n>]
//
// Env: MONO_TOKEN (app token for Jeffi_Stores), ORG_TOKEN (this repo's GITHUB_TOKEN), OSS_BOT_NAME / OSS_BOT_EMAIL.
// The change is the merged commit's diff, minus managed files, applied 3-way onto Jeffi_Stores' base branch.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'repos.json'), 'utf8'))
const CONVENTIONAL = /^(feat|fix|perf|refactor|revert|docs|test|ci|build|chore)(\([a-z0-9._/,+ -]+\))?!?: .+/

const opts = {}
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i += 2) opts[argv[i].replace(/^--/, '')] = argv[i + 1]
for (const k of ['repo', 'sha', 'src', 'mono']) if (!opts[k]) throw new Error(`--${k} is required`)
const repo = manifest.repos.find(r => r.name === opts.repo)
if (!repo) throw new Error(`no repo named ${opts.repo} in repos.json`)
const src = path.resolve(opts.src)
const mono = path.resolve(opts.mono)
const sha = opts.sha
const sha7 = sha.slice(0, 7)
const prNumber = opts.pr ? Number(opts.pr) : null
const run = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null

const git = (cwd, args, input) => execFileSync('git', args, { cwd, input, encoding: 'utf8', maxBuffer: 1 << 30, stdio: ['pipe', 'pipe', 'pipe'] })
const tryGit = (cwd, args, input) => { try { return git(cwd, args, input) } catch { return null } }

async function api(token, method, url, body) {
  const res = await fetch(`https://api.github.com${url}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'jeffi-erp-promote' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) throw Object.assign(new Error(`${method} ${url}: ${res.status} ${data?.message ?? text}`), { status: res.status, data })
  return data
}

function summary(md) {
  console.log(md)
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`)
}

async function orgIssue(title, body) {
  if (!process.env.ORG_TOKEN) return
  await api(process.env.ORG_TOKEN, 'POST', `/repos/${manifest.org}/${repo.name}/issues`, { title, body, labels: ['promotion-failed'] })
    .catch(e => console.log(`couldn't open an issue: ${e.message}`))
}

const literal = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 30, env: { ...process.env, GIT_LITERAL_PATHSPECS: '1' } })
const managed = [...manifest.managed, ...(repo.managed ?? [])]
const parent = git(src, ['rev-parse', `${sha}^1`]).trim()
const notManaged = ['--', '.', ...managed.map(m => `:(exclude)${m.replace(/\/$/, '')}`)]
const monoPath = f => (repo.path ? `${repo.path}/${f}` : f)

// Files Jeffi_Stores already has in their new state (or already lacks, for a deletion) are left out, so a revert
// or a change that also landed upstream doesn't read as a conflict.
const raw = git(src, ['diff', '--raw', '-z', '--no-renames', '--full-index', '--no-abbrev', parent, sha, ...notManaged]).split('\0')
const entries = []
for (let i = 0; i + 1 < raw.length; i += 2) {
  const m = raw[i].match(/^:(\d+) (\d+) ([0-9a-f]+) ([0-9a-f]+) ([A-Z])/)
  if (m) entries.push({ dstMode: m[2], dst: m[4], status: m[5], path: raw[i + 1] })
}
if (!entries.length) {
  summary(`Nothing to promote: ${sha7} only changes managed files.`)
  process.exit(0)
}
const have = new Map()
for (const line of literal(mono, ['ls-tree', '-r', '-z', '--full-tree', 'HEAD', '--', ...entries.map(e => monoPath(e.path))]).split('\0').filter(Boolean)) {
  const [meta, p] = line.split('\t')
  const [mode, , oid] = meta.split(' ')
  have.set(p, { mode, oid })
}
const pending = entries.filter(e => {
  const h = have.get(monoPath(e.path))
  return e.status === 'D' ? !!h : !h || h.oid !== e.dst || h.mode !== e.dstMode
})
const changed = pending.map(e => e.path)
const patch = pending.length ? literal(src, ['diff', '--binary', '--full-index', '--no-renames', parent, sha, '--', ...changed]) : ''

// The 3-way apply needs each file's pre-image; Jeffi_Stores may not have it yet (an earlier org change not yet promoted).
for (const m of patch.matchAll(/^index ([0-9a-f]{40})\.\.[0-9a-f]{40}/gm)) {
  const oid = m[1]
  if (/^0+$/.test(oid) || tryGit(mono, ['cat-file', '-e', oid]) !== null) continue
  const blob = execFileSync('git', ['cat-file', 'blob', oid], { cwd: src, maxBuffer: 1 << 30 })
  execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: mono, input: blob })
}

let pr = null
if (prNumber && process.env.ORG_TOKEN) pr = await api(process.env.ORG_TOKEN, 'GET', `/repos/${manifest.org}/${repo.name}/pulls/${prNumber}`)
const subject = (pr?.title ?? git(src, ['log', '-1', '--format=%s', sha]).trim()).replace(/\s*\(#\d+\)$/, '')
const scope = repo.name.replace(/-service$/, '')
const title = CONVENTIONAL.test(subject) ? subject : `chore(${scope}): ${subject.charAt(0).toLowerCase()}${subject.slice(1)}`
const branch = `oss/${repo.name}/${prNumber ? `pr-${prNumber}` : sha7}`
const source = `${manifest.org}/${repo.name}@${sha}`
const prUrl = pr?.html_url ?? null

async function alreadyThere() {
  summary(`Nothing to promote: ${manifest.upstream.repo} ${manifest.promote.base} already has this change (${sha7}).`)
  if (prNumber && process.env.ORG_TOKEN) {
    await api(process.env.ORG_TOKEN, 'POST', `/repos/${manifest.org}/${repo.name}/issues/${prNumber}/comments`, {
      body: `Not promoted: ${manifest.upstream.repo} already has this change.`,
    }).catch(e => console.log(`couldn't comment on #${prNumber}: ${e.message}`))
  }
  process.exit(0)
}
if (!pending.length) await alreadyThere()

const patchFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'promote-')), 'change.patch')
fs.writeFileSync(patchFile, patch)
git(mono, ['switch', '--quiet', '-C', branch])
try {
  git(mono, ['apply', '--3way', '--index', '--whitespace=nowarn', ...(repo.path ? [`--directory=${repo.path}`] : []), patchFile])
} catch (e) {
  const conflicted = (tryGit(mono, ['diff', '--name-only', '--diff-filter=U']) ?? '').split('\n').filter(Boolean)
  const detail = (e.stderr || e.message).toString().trim().split('\n').slice(0, 30).join('\n')
  await orgIssue(`Promotion of ${prNumber ? `#${prNumber}` : sha7} doesn't apply to Jeffi_Stores`, [
    `The merged change ${sha7}${prUrl ? ` (${prUrl})` : ''} conflicts with \`${manifest.promote.base}\` of Jeffi_Stores, so it wasn't promoted.`,
    conflicted.length ? `\nConflicting files:\n${conflicted.map(f => `- \`${f}\``).join('\n')}` : '',
    `\n\`\`\`\n${detail}\n\`\`\``,
    `\nA maintainer resolves this in Jeffi_Stores by hand${run ? `, or re-runs the promotion once the base has the earlier change: ${run}` : ''}.`,
  ].join('\n'))
  summary(`Promotion failed: the change doesn't apply to Jeffi_Stores ${manifest.promote.base}.\n\n${conflicted.map(f => `- ${f}`).join('\n')}\n\n\`\`\`\n${detail}\n\`\`\``)
  process.exit(1)
}

if (tryGit(mono, ['diff', '--cached', '--quiet']) !== null) await alreadyThere()

const [authorName, authorEmail, authorDate] = git(src, ['log', '-1', '--format=%an%x00%ae%x00%aI', sha]).trim().split('\0')
const message = [
  title,
  '',
  `Promoted from ${manifest.org}/${repo.name}${prNumber ? `#${prNumber}` : ''}, merged there as ${sha7}.`,
  '',
  `OSS-Source: ${source}`,
  ...(prUrl ? [`OSS-PR: ${prUrl}`] : []),
].join('\n')
const env = {
  ...process.env,
  GIT_AUTHOR_NAME: authorName, GIT_AUTHOR_EMAIL: authorEmail, GIT_AUTHOR_DATE: authorDate,
  GIT_COMMITTER_NAME: process.env.OSS_BOT_NAME || 'jeffi-erp-promote', GIT_COMMITTER_EMAIL: process.env.OSS_BOT_EMAIL || 'promote@users.noreply.github.com',
}
execFileSync('git', ['commit', '--quiet', '-F', '-'], { cwd: mono, input: message, env })
git(mono, ['push', '--quiet', '--force', 'origin', `HEAD:refs/heads/${branch}`])

const body = [
  `Promoted from **${manifest.org}/${repo.name}${prNumber ? `#${prNumber}` : ''}**${pr ? ` by \`${pr.user.login}\`` : ''}. It was merged there as \`${sha7}\` after that repo's pipeline (pre-build, build) passed, and the promotion was approved.`,
  '',
  ...(prUrl ? [`- Org PR: ${prUrl}`] : []),
  ...(run ? [`- Org pipeline: ${run}`] : []),
  `- Files (${changed.length}): ${changed.slice(0, 15).map(f => `\`${repo.path ? `${repo.path}/` : ''}${f}\``).join(', ')}${changed.length > 15 ? ', …' : ''}`,
  '',
  ...(pr?.body?.trim() ? ['<details><summary>Original description</summary>', '', pr.body.trim().slice(0, 6000), '', '</details>', ''] : []),
  `OSS-Source: ${source}`,
].join('\n')

const [upOwner, upName] = manifest.upstream.repo.split('/')
if (!process.env.MONO_TOKEN) {
  summary(`No MONO_TOKEN: pushed ${branch}; would open "${title}" on ${manifest.upstream.repo}.\n\n${body}`)
  process.exit(0)
}
let created
try {
  created = await api(process.env.MONO_TOKEN, 'POST', `/repos/${manifest.upstream.repo}/pulls`, { title, head: branch, base: manifest.promote.base, body })
} catch (e) {
  if (e.status !== 422) throw e
  const [open] = await api(process.env.MONO_TOKEN, 'GET', `/repos/${manifest.upstream.repo}/pulls?state=open&head=${upOwner}:${encodeURIComponent(branch)}`)
  if (!open) throw e
  created = await api(process.env.MONO_TOKEN, 'PATCH', `/repos/${manifest.upstream.repo}/pulls/${open.number}`, { title, body })
}
summary(`Promoted ${sha7} to ${upName}: ${created.html_url}`)
if (prNumber && process.env.ORG_TOKEN) {
  await api(process.env.ORG_TOKEN, 'POST', `/repos/${manifest.org}/${repo.name}/issues/${prNumber}/comments`, {
    body: `Promoted to Jeffi_Stores: ${created.html_url}. It ships with a later Jeffi_Stores release, and the export then brings it back here.`,
  }).catch(e => console.log(`couldn't comment on #${prNumber}: ${e.message}`))
}
