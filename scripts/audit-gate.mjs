#!/usr/bin/env node
// Dependency audit gate (the CI "Security" job): `npm audit` on every lockfile fails on any advisory, of any severity,
// that .github/audit-allowlist.json doesn't list, and on allowlist entries past their review date.
// Fix a finding with `npm audit fix` in that folder, a version bump, or an `overrides` pin. Allowlist only what can't be
// fixed yet, with the reason. Run it locally before pushing: `node scripts/audit-gate.mjs`.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const PROJECTS = ['.', 'ai-platform', 'mobile-service/client']
const allowlist = JSON.parse(readFileSync(process.env.AUDIT_ALLOWLIST || '.github/audit-allowlist.json', 'utf8')).advisories
const today = new Date().toISOString().slice(0, 10)
let failed = false

function audit(dir) {
  for (let attempt = 1; ; attempt++) {
    try {
      return JSON.parse(execFileSync('npm', ['audit', '--json'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 }))
    } catch (e) {
      // npm audit exits 1 when it finds something; the report is still on stdout.
      try { return JSON.parse(e.stdout) } catch {}
      if (attempt === 2) throw new Error(`npm audit failed in ${dir}: ${e.message}`)
    }
  }
}

for (const dir of PROJECTS) {
  if (!existsSync(`${dir}/package-lock.json`)) continue
  const report = audit(dir)
  if (report.error) {
    console.error(`::error::npm audit in ${dir}: ${report.error.summary || JSON.stringify(report.error)}`)
    failed = true
    continue
  }
  const found = new Map()
  for (const v of Object.values(report.vulnerabilities || {}))
    for (const a of v.via) if (typeof a === 'object') found.set(a.url.split('/').pop(), a)
  const open = [...found].filter(([id]) => !allowlist.some(x => x.id === id && x.project === dir))
  const allowed = found.size - open.length
  console.log(`${dir}: ${open.length ? `${open.length} new advisor${open.length === 1 ? 'y' : 'ies'}` : 'clean'}${allowed ? ` (${allowed} allowlisted)` : ''}`)
  for (const [id, a] of open) {
    console.error(`::error::${dir}: ${a.name} ${a.range} — ${a.severity}: ${a.title} (${id}). Run \`npm audit fix\` in ${dir}, bump it, or pin a fixed version in overrides.`)
    failed = true
  }
  for (const x of allowlist.filter(x => x.project === dir && !found.has(x.id)))
    console.log(`  note: ${x.id} (${x.package}) is no longer reported; remove it from the allowlist.`)
}

for (const x of allowlist)
  if (x.review_by && x.review_by < today) {
    console.error(`::error::Allowlisted ${x.id} (${x.package}, ${x.project}) was due for review on ${x.review_by}: fix it or renew the entry with a reason.`)
    failed = true
  }

process.exit(failed ? 1 : 0)
