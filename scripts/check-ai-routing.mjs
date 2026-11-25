#!/usr/bin/env node
// Every AI call goes through the AI gateway (store-core's ai-client / ai/media / ai/stock, or scripts/lib/ai-gateway.mjs).
// Fails when app, package or script code imports a model SDK or names a model provider's host. The gateway and
// voice-service (which own the provider calls) and tests are not scanned. A justified exception goes in
// scripts/ai-routing-allowlist.txt as `<path>  # reason`; an entry that no longer matches anything fails too.
// Usage: node scripts/check-ai-routing.mjs   (npm run check:ai-routing)
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const ALLOWLIST = 'scripts/ai-routing-allowlist.txt'

const CODE = /\.(?:[cm]?[jt]sx?|py)$/
const SKIP = [
  /^ai-platform\//,
  /^voice-service\//,
  /^vendor\//,
  /^graphify-out\//,
  /^\.claude\//,
  /(?:^|\/)node_modules\//,
  /(?:^|\/)(?:tests?|integration-tests|ui-tests|e2e|__tests__|__mocks__)\//,
  /\.(?:test|spec)\.[cm]?[jt]sx?$/,
  /(?:^|\/)test_[^/]*\.py$/,
  /^scripts\/check-ai-routing\.mjs$/,
]

const SDKS = [
  'openai', '@anthropic-ai/[\\w.-]+', 'replicate', '@google/genai', '@google/generative-ai', '@google-cloud/vertexai',
  '@google-cloud/aiplatform', '@google-cloud/text-to-speech', '@google-cloud/speech', '@huggingface/[\\w.-]+',
  '@xenova/transformers', 'ollama', '@azure/openai', '@azure-rest/ai-inference', 'microsoft-cognitiveservices-speech-sdk',
  'cohere-ai', '@mistralai/[\\w.-]+', 'groq-sdk', '@aws-sdk/client-bedrock[\\w-]*', '@aws-sdk/client-polly',
  '@aws-sdk/client-transcribe[\\w-]*', 'elevenlabs', '@elevenlabs/[\\w.-]+', '@fal-ai/[\\w.-]+', 'together-ai',
  'onnxruntime-(?:web|node|common)', '@mlc-ai/[\\w.-]+', '@mediapipe/tasks-(?:genai|text|audio)', 'sarvamai', 'ai',
  '@ai-sdk/[\\w.-]+', 'langchain', '@langchain/[\\w.-]+', 'llamaindex', '@tensorflow/[\\w.-]+', '@tensorflow-models/[\\w.-]+',
]
const PY_SDKS = ['openai', 'anthropic', 'replicate', 'google\\.generativeai', 'google\\.genai', 'transformers', 'ollama', 'sarvamai', 'elevenlabs', 'cohere', 'mistralai', 'groq', 'vertexai']
const HOSTS = [
  'api\\.anthropic\\.com', 'api\\.openai\\.com', '[\\w-]+\\.openai\\.azure\\.com', '[\\w-]+\\.cognitiveservices\\.azure\\.com',
  '[\\w-]+\\.(?:tts|stt)\\.speech\\.microsoft\\.com', 'generativelanguage\\.googleapis\\.com', '[\\w-]*aiplatform\\.googleapis\\.com',
  'texttospeech\\.googleapis\\.com', 'speech\\.googleapis\\.com', 'api\\.replicate\\.com', 'api\\.sarvam\\.ai', 'api\\.elevenlabs\\.io',
  'api\\.groq\\.com', 'api\\.mistral\\.ai', 'api\\.together\\.xyz', 'api\\.cohere\\.(?:ai|com)', 'api-inference\\.huggingface\\.co',
  'router\\.huggingface\\.co', 'huggingface\\.co/', 'openrouter\\.ai', 'api\\.deepseek\\.com', 'api\\.stability\\.ai', '(?:queue\\.)?fal\\.run',
  'api\\.x\\.ai',
]

export const RULES = [
  { id: 'sdk', re: new RegExp(`(?:\\bfrom\\s+|\\bimport\\s*\\(\\s*|\\brequire\\s*\\(\\s*|^\\s*import\\s+)['"](?:${SDKS.join('|')})(?:/[^'"]*)?['"]`), js: true },
  { id: 'sdk', re: new RegExp(`^\\s*(?:import\\s+(?:${PY_SDKS.join('|')})\\b|from\\s+(?:${PY_SDKS.join('|')})\\b|from\\s+google\\s+import\\s+genai\\b)`), py: true },
  { id: 'host', re: new RegExp(`(?:^|[^\\w.-])(?:${HOSTS.join('|')})`) },
  { id: 'ollama', re: /:11434\b|\/api\/(?:chat|embeddings|generate|tags)\b|\b(?:RAG_)?OLLAMA_[A-Z_]*URLS?\b/ },
  { id: 'razer-backend', re: /\/sdapi\/v1\/|:8866\b/ },
]

export function isScanned(file) {
  return CODE.test(file) && !SKIP.some(re => re.test(file))
}

/** Lines of `src` (a file at `file`) that reach a model without the gateway. */
export function findViolations(file, src) {
  const py = file.endsWith('.py')
  const out = []
  src.split('\n').forEach((line, i) => {
    for (const r of RULES) {
      if ((r.js && py) || (r.py && !py)) continue
      if (r.re.test(line)) {
        out.push({ file, line: i + 1, rule: r.id, text: line.trim().slice(0, 160) })
        break
      }
    }
  })
  return out
}

/** `<path>  # reason` per line; blank lines and full-line comments are ignored. A missing reason is an error. */
export function parseAllowlist(text) {
  const entries = []
  const errors = []
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim()
    if (!line || line.startsWith('#')) return
    const [p, ...reason] = line.split('#')
    if (!reason.join('#').trim()) errors.push(`${ALLOWLIST}:${i + 1}: "${p.trim()}" needs a reason after '#'`)
    entries.push(p.trim())
  })
  return { entries, errors }
}

export function check({ files, read, allowlistText = '' }) {
  const { entries, errors } = parseAllowlist(allowlistText)
  const allowed = new Set(entries)
  const used = new Set()
  const violations = []
  for (const f of files) {
    if (!isScanned(f)) continue
    const found = findViolations(f, read(f))
    if (!found.length) continue
    if (allowed.has(f)) used.add(f)
    else violations.push(...found)
  }
  const stale = entries.filter(e => !used.has(e))
  return { violations, stale, errors }
}

function main() {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }).split('\0').filter(Boolean)
  const allowlistText = fs.existsSync(path.join(ROOT, ALLOWLIST)) ? fs.readFileSync(path.join(ROOT, ALLOWLIST), 'utf8') : ''
  const read = f => {
    try {
      return fs.readFileSync(path.join(ROOT, f), 'utf8')
    } catch {
      return ''
    }
  }
  const { violations, stale, errors } = check({ files, read, allowlistText })
  for (const v of violations) console.error(`${v.file}:${v.line}: [${v.rule}] ${v.text}`)
  for (const s of stale) console.error(`${ALLOWLIST}: "${s}" matches nothing any more; remove it`)
  for (const e of errors) console.error(e)
  if (violations.length || stale.length || errors.length) {
    console.error(
      `\ncheck-ai-routing: ${violations.length} direct model call(s). Every AI call goes through the AI gateway ` +
        `(store-core ai-client / ai/media / ai/stock; scripts use scripts/lib/ai-gateway.mjs).`
    )
    process.exit(1)
  }
  console.log(`check-ai-routing: ok (${files.filter(isScanned).length} files scanned)`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
