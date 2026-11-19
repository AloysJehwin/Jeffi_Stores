#!/usr/bin/env node
// Runs one stage of a repo's checks from repos.json in an assembled workspace (oss/assemble.mjs first).
// Managed from Jeffi_Stores (oss/workspace/).
//
//   node oss/checks.mjs <repo> <stage>    stage: pr | prebuild | build
//   node oss/checks.mjs <repo> --list     print the commands without running them
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'repos.json'), 'utf8'))
const [name, stage] = process.argv.slice(2)
const repo = manifest.repos.find(r => r.name === name)
if (!repo) throw new Error(`no repo named ${name} in repos.json`)

if (stage === '--list') {
  for (const [s, steps] of Object.entries(repo.checks)) for (const step of steps) console.log(`${s}\t${step.name}\t${step.run}`)
  process.exit(0)
}
const steps = repo.checks[stage]
if (!steps) throw new Error(`stage must be one of ${Object.keys(repo.checks).join(', ')}`)

const ci = !!process.env.GITHUB_ACTIONS
const failed = []
for (const step of steps) {
  console.log(ci ? `::group::${step.name}` : `\n== ${step.name}: ${step.run}`)
  if (ci) console.log(`$ ${step.run}`)
  const env = { ...process.env, ONNXRUNTIME_NODE_INSTALL: 'skip', ...(step.env ? manifest.env[step.env] : {}) }
  const res = spawnSync('bash', ['-o', 'pipefail', '-c', step.run], { cwd: root, env, stdio: 'inherit' })
  if (ci) console.log('::endgroup::')
  if (res.status !== 0) {
    failed.push(step.name)
    console.log(ci ? `::error title=${step.name}::exited ${res.status ?? res.signal}` : `!! ${step.name} failed (${res.status ?? res.signal})`)
  }
}

const summary = steps.map(s => `| ${s.name} | ${failed.includes(s.name) ? 'failed' : 'passed'} | \`${s.run}\` |`)
if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${name} · ${stage}\n\n| Check | Result | Command |\n|---|---|---|\n${summary.join('\n')}\n`)
}
if (failed.length) {
  console.log(`\n${failed.length} of ${steps.length} failed: ${failed.join(', ')}`)
  process.exit(1)
}
console.log(`\nAll ${steps.length} passed.`)
