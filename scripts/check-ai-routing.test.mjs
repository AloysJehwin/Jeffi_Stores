// node --test scripts/check-ai-routing.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { check, findViolations, isScanned, parseAllowlist } from './check-ai-routing.mjs'

test('flags model SDK imports in JS/TS, dynamic imports and requires', () => {
  const src = [
    "import OpenAI from 'openai'",
    "import Anthropic from '@anthropic-ai/sdk'",
    "const { pipeline } = await import('@huggingface/transformers')",
    "const r = require('replicate')",
    "import { GoogleGenAI } from '@google/genai'",
    "import { streamText } from 'ai'",
    "import * as ort from 'onnxruntime-web'",
    "import { aiChat } from '@/lib/shared/ai-client'",
    "import openaiLogo from './openai.svg'",
    "import { x } from 'ai-helpers'",
  ].join('\n')
  assert.deepEqual(findViolations('packages/x/a.ts', src).map(v => v.line), [1, 2, 3, 4, 5, 6, 7])
})

test('flags provider hosts and the Razer backends, not the gateway', () => {
  const src = [
    "fetch('https://api.anthropic.com/v1/messages')",
    "const u = 'https://myres.openai.azure.com/openai'",
    "fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}`)",
    "const OLLAMA = 'http://100.82.208.8:11434'",
    "fetch('https://api.sarvam.ai/text-to-speech')",
    "fetch(`${sd}/sdapi/v1/txt2img`)",
    "fetch(`${aiGatewayUrl()}/v1/chat`)",
    "const docs = 'https://notapi.anthropic.com.example'",
    "const base = process.env.OLLAMA_BASE_URL",
    "await fetch(`${base}/api/embeddings`, { method: 'POST' })",
  ].join('\n')
  assert.deepEqual(findViolations('scripts/x.mjs', src).map(v => [v.line, v.rule]), [
    [1, 'host'],
    [2, 'host'],
    [3, 'host'],
    [4, 'ollama'],
    [5, 'host'],
    [6, 'razer-backend'],
    [9, 'ollama'],
    [10, 'ollama'],
  ])
})

test('flags Python SDK imports only in Python files', () => {
  const py = ['import anthropic', 'from openai import OpenAI', 'from google import genai', 'import json'].join('\n')
  assert.deepEqual(findViolations('scripts/x.py', py).map(v => v.line), [1, 2, 3])
  assert.deepEqual(findViolations('scripts/x.ts', 'import anthropic'), [])
})

test('skips the gateway, voice-service, tests and non-code files', () => {
  for (const f of [
    'ai-platform/gateway/src/providers/anthropic.ts',
    'voice-service/app/llm.py',
    'packages/store-core/tests/lib/ai-client.test.ts',
    'controller-service/tests/api/x/route.test.ts',
    'packages/store-core/integration-tests/ui/a.test.tsx',
    'tests/voice-e2e/e2e/sarvam.py',
    'docs/RAG_SETUP.md',
    'deploy/k8s/platform/48-ai-gateway-service.yaml',
  ])
    assert.equal(isScanned(f), false, f)
  for (const f of ['packages/store-core/src/lib/shared/ai-client.ts', 'scripts/embed-everything.mjs', 'mobile-service/client/app/x.tsx', 'scripts/demo-films/music/make-music.py'])
    assert.equal(isScanned(f), true, f)
})

test('allowlist: entries need a reason, excuse their file, and fail once stale', () => {
  assert.deepEqual(parseAllowlist('# header\n\nscripts/a.py  # why\nscripts/b.py\n'), {
    entries: ['scripts/a.py', 'scripts/b.py'],
    errors: ['scripts/ai-routing-allowlist.txt:4: "scripts/b.py" needs a reason after \'#\''],
  })
  const files = { 'scripts/a.py': 'import anthropic', 'packages/x/b.ts': "import OpenAI from 'openai'", 'packages/x/c.ts': 'ok' }
  const r = check({ files: Object.keys(files), read: f => files[f], allowlistText: 'scripts/a.py # ok\nscripts/gone.py # was needed\n' })
  assert.deepEqual(r.violations.map(v => v.file), ['packages/x/b.ts'])
  assert.deepEqual(r.stale, ['scripts/gone.py'])
  assert.deepEqual(r.errors, [])
})
