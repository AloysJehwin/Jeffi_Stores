#!/usr/bin/env node
/**
 * Bootstrap secrets loader — runs before cluster-server.js.
 *
 * Fetches all key/value pairs from AWS Secrets Manager (jeffi/production)
 * and writes them into process.env BEFORE the app starts, so every module
 * that reads process.env at require-time gets the real values.
 *
 * Override / fallback behaviour:
 *   - Any var already set in process.env (e.g. from docker-compose environment:
 *     block) is NOT overwritten — compose overrides win.
 *   - If SM_SECRET_ID is unset, defaults to 'jeffi/production'.
 *   - If ALLOW_ENV_FALLBACK=true, a failed SM fetch is a warning, not a fatal
 *     error. Use this for local dev where .env.local is loaded by Next.js.
 *   - If AWS credentials are absent and ALLOW_ENV_FALLBACK=true, the script
 *     skips SM entirely (local dev with no AWS config).
 *
 * Usage (container CMD):
 *   node scripts/load-secrets.mjs && node cluster-server.js
 */

import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager'

const SECRET_ID = process.env.SM_SECRET_ID || 'jeffi/production'
const REGION    = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1'
const FALLBACK  = process.env.ALLOW_ENV_FALLBACK === 'true'

async function loadSecrets() {
  // If no AWS credentials and fallback is allowed, skip silently (local dev).
  const hasCredentials =
    process.env.AWS_ACCESS_KEY_ID ||
    process.env.AWS_PROFILE ||
    // EC2 instance metadata credentials — present when running on EC2 with an IAM role.
    // We detect this by checking for the role name env var set by the IAM role.
    process.env.AWS_EXECUTION_ENV ||
    process.env.ECS_CONTAINER_METADATA_URI_V4 ||
    // Simplest heuristic: if the instance metadata service is reachable we have creds.
    // But we don't want to make an HTTP call here, so just check the AWS SDK's chain.
    true // always attempt — the SDK will fail fast if no creds are available

  const client = new SecretsManagerClient({ region: REGION })

  let secretString
  try {
    const res = await client.send(new GetSecretValueCommand({ SecretId: SECRET_ID }))
    secretString = res.SecretString
  } catch (err) {
    const msg = `[load-secrets] Failed to fetch "${SECRET_ID}" from Secrets Manager: ${err.message}`
    if (FALLBACK) {
      process.stderr.write(`${msg} — continuing with process.env (ALLOW_ENV_FALLBACK=true)\n`)
      return
    }
    process.stderr.write(`${msg}\nSet ALLOW_ENV_FALLBACK=true to skip SM and use process.env instead.\n`)
    process.exit(1)
  }

  if (!secretString) {
    const msg = `[load-secrets] Secret "${SECRET_ID}" exists but SecretString is empty`
    if (FALLBACK) { process.stderr.write(`${msg} — continuing\n`); return }
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

  let loaded = 0
  let skipped = 0
  for (const [key, value] of Object.entries(secrets)) {
    if (typeof value !== 'string') continue
    if (process.env[key] !== undefined) {
      // Already set (e.g. docker-compose environment: block) — compose wins.
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
