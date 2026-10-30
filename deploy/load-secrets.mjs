#!/usr/bin/env node
/**
 * Bootstrap secrets loader.
 *
 * TWO modes depending on context:
 *
 * PROD (container, NODE_ENV=production):
 *   Runs in the same long-lived process as cluster-server.js. Fetches SM and
 *   writes values into process.env before the app starts.
 *   CMD: node deploy/load-secrets.mjs && node cluster-server.js
 *
 * DEV (predev npm script, NODE_ENV=development):
 *   Runs in a short-lived child process — process.env changes die with it and
 *   are NOT inherited by the next dev server. Instead, writes a .env.local file
 *   that Next.js loads natively at startup (same mechanism as before, but
 *   sourced from SM rather than a hand-edited file).
 *
 * Auto-selects the right secret:
 *   - SM_SECRET_ID env var overrides everything
 *   - NODE_ENV=production → jeffi/production
 *   - everything else     → jeffi/local
 *
 * Existing process.env values (docker-compose environment: block) are never
 * overwritten in prod mode. In dev mode, existing .env.local entries win
 * because Next.js loads the file and process.env is already set by the time
 * the app reads it (so SM values written to .env.local act as defaults).
 */

import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'
import { writeFileSync, existsSync, readFileSync, lstatSync, symlinkSync, unlinkSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')
// Services (messaging-service etc.) reuse this loader and write their own .env.local.
const OUT_DIR = process.env.ENV_OUT_DIR ? resolve(process.env.ENV_OUT_DIR) : REPO_ROOT

const isProduction = process.env.NODE_ENV === 'production' || process.env.SM_ENV === 'production'
const DEFAULT_SECRET = isProduction ? 'jeffi/production' : 'jeffi/local'
const SECRET_ID = process.env.SM_SECRET_ID || DEFAULT_SECRET
const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1'
const FALLBACK = process.env.ALLOW_ENV_FALLBACK === 'true'

async function loadSecrets() {
  const client = new SecretsManagerClient({ region: REGION })

  let secretString
  try {
    const res = await client.send(new GetSecretValueCommand({ SecretId: SECRET_ID }))
    secretString = res.SecretString
  } catch (err) {
    const msg = `[load-secrets] Failed to fetch "${SECRET_ID}" from Secrets Manager: ${err.message}`
    if (FALLBACK) {
      process.stderr.write(`${msg} — continuing (ALLOW_ENV_FALLBACK=true)\n`)
      return
    }
    process.stderr.write(`${msg}\nSet ALLOW_ENV_FALLBACK=true to skip SM.\n`)
    process.exit(1)
  }

  if (!secretString) {
    const msg = `[load-secrets] Secret "${SECRET_ID}" exists but SecretString is empty`
    if (FALLBACK) {
      process.stderr.write(`${msg} — continuing\n`)
      return
    }
    process.stderr.write(`${msg}\n`)
    process.exit(1)
  }

  let secrets
  try {
    secrets = JSON.parse(secretString)
  } catch {
    process.stderr.write(`[load-secrets] SecretString for "${SECRET_ID}" is not valid JSON\n`)
    process.exit(1)
  }

  if (!isProduction) {
    // DEV: write to .env.local so Next.js picks it up natively.
    // Serialize each value safely — escape newlines (e.g. GOOGLE_PRIVATE_KEY).
    const lines = Object.entries(secrets)
      .filter(([, v]) => typeof v === 'string')
      .map(([k, v]) => `${k}=${v.includes('\n') ? JSON.stringify(v) : v}`)
    // Local-only overrides that must survive this regeneration (e.g. TENANT_MTLS_ENFORCED=false
    // for local tenant-admin access). .env.local.overrides is gitignored and NEVER read in prod.
    // Appended last so its KEY=VALUE lines win over the Secrets Manager values above.
    const overridePath = resolve(OUT_DIR, '.env.local.overrides')
    let overrideCount = 0
    if (existsSync(overridePath)) {
      const extra = readFileSync(overridePath, 'utf8')
        .split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('#') && l.includes('='))
      overrideCount = extra.length
      lines.push(...extra)
    }
    const envPath = resolve(OUT_DIR, '.env.local')
    writeFileSync(envPath, lines.join('\n') + '\n', 'utf8')
    // Next loads env files from each app's project dir; point every app at this one.
    for (const app of ['controller-service', 'storefront-service', 'admin-service', 'business-service']) {
      const appEnv = resolve(REPO_ROOT, app, '.env.local')
      if (OUT_DIR !== REPO_ROOT || !existsSync(resolve(REPO_ROOT, app))) continue
      let stat = null
      try { stat = lstatSync(appEnv) } catch {}
      if (!stat || stat.isSymbolicLink()) {
        if (stat) unlinkSync(appEnv)
        symlinkSync('../.env.local', appEnv)
      }
    }
    process.stdout.write(
      `[load-secrets] Wrote ${Object.keys(secrets).length} secrets from "${SECRET_ID}"` +
        `${overrideCount ? ` + ${overrideCount} local override(s)` : ''} → .env.local\n`
    )
    return
  }

  // PROD: inject into process.env (same process as the app).
  let loaded = 0,
    skipped = 0
  for (const [key, value] of Object.entries(secrets)) {
    if (typeof value !== 'string') continue
    if (process.env[key] !== undefined) {
      skipped++
      continue
    }
    process.env[key] = value
    loaded++
  }
  process.stdout.write(
    `[load-secrets] Loaded ${loaded} secrets from "${SECRET_ID}" (${skipped} skipped — already set)\n`
  )
}

await loadSecrets()

// In prod, chain into the app WITHIN the same environment. The old Docker CMD
// (`node load-secrets.mjs && node cluster-server.js`) ran the server as a SEPARATE
// process, so the secrets injected into THIS process's env never reached it —
// the app booted with no JWT_SECRET/RDS_HOST/etc and failed its health check.
// Spawning the server as a child here means it inherits the now-populated env
// (and passes it to its forked workers). Only runs when told to via SPAWN_APP=1
// so `predev` (which just writes .env.local) is unaffected.
if (process.env.SPAWN_APP === '1') {
  const { spawn } = await import('child_process')
  // APP_ENTRY picks the process (the controller's cluster-server.js, or a service's src/server.ts with
  // APP_NODE_ARGS='--import tsx'); paths are relative to the repo/image root. APP_ARGS go to the script.
  const entry = resolve(
    REPO_ROOT,
    process.env.APP_ENTRY || (existsSync(resolve(REPO_ROOT, 'controller-service/cluster-server.js')) ? 'controller-service/cluster-server.js' : 'cluster-server.js')
  )
  const nodeArgs = (process.env.APP_NODE_ARGS || '').split(' ').filter(Boolean)
  const appArgs = (process.env.APP_ARGS || '').split(' ').filter(Boolean)
  const child = spawn(process.execPath, [...nodeArgs, entry, ...appArgs], { stdio: 'inherit', env: process.env, cwd: process.env.APP_CWD ? resolve(REPO_ROOT, process.env.APP_CWD) : dirname(entry) })
  child.on('exit', (code, signal) => {
    process.exit(signal ? 1 : (code ?? 0))
  })
  // Forward termination signals so container stop/restart is graceful.
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => child.kill(sig))
  }
}
