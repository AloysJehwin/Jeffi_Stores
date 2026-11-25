// A stand-in AI gateway (the API lib/shared/ai-client.ts calls) for the visual editor's AI flows end to end, so they
// run through the real routes, prompts and compiler without Claude: start the apps with
// AI_GATEWAY_URL=http://localhost:8098 and the AI spec starts this. It answers as Claude in shape, with fixed words,
// and keeps every request so a spec can read the prompts. Stock search finds nothing and pictures fail (no S3 writes).
import http from 'node:http'

export const AI_MOCK_PORT = 8098

/** The words the mock answers with. */
export const MOCK = {
  changed: 'Changed with AI',
  rewrite: 'Crafted by hand, sent all over India',
  shorten: 'Made by hand',
  hindi: 'हाथ से बना, पूरे भारत में भेजा गया',
  fresh: 'A fresh heading',
}

type Msg = { role: string; content: string }
export interface MockCall {
  path: string
  body: { messages?: Msg[] } & Record<string, unknown>
}

const text = (body: MockCall['body'], role: string) => (body.messages ?? []).filter(m => m.role === role).map(m => (typeof m.content === 'string' ? m.content : '')).join('\n')

/** A tweak's section with the selected element's words (else the first heading's) replaced; its data-e ids kept. */
function tweak(user: string): string {
  const src = /```tsx\n([\s\S]*?)```/.exec(user)?.[1] ?? ''
  const id = /The owner selected <\w+ data-e="([^"]+)"/.exec(user)?.[1]
  const safeId = id?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const at = safeId ? new RegExp(`(data-e="${safeId}"[^>]*>)([^<{]*)(<)`) : /(<h[1-3][^>]*>)([^<{]*)(<)/
  return '```tsx\n' + src.replace(at, (_m, a: string, _w: string, b: string) => `${a}${MOCK.changed}${b}`) + '```'
}

/** A plain section for the page writer, its heading the first of the owner's kept words when the brief has them. */
function section(user: string): string {
  const kept = /reuse them as written[^:]*: "([^"]+)"/.exec(user)?.[1]
  const must = /It must contain: ([^.]+)\./.exec(user)?.[1]?.match(/<(\w+)>/g)?.map(p => `<${p.slice(1, -1)} />`) ?? []
  return `\`\`\`tsx
export default function Section() {
  return (
    <section className="bg-surface py-10 md:py-16">
      <div className="mx-auto max-w-5xl px-4">
        <h2 className="font-display text-3xl text-foreground">${kept ?? MOCK.fresh}</h2>
        <p className="mt-3 text-base text-foreground-secondary">Small batches, made with care.</p>
        ${must.join('\n        ')}
      </div>
    </section>
  )
}
\`\`\``
}

function answer(body: MockCall['body']): string {
  const system = text(body, 'system')
  const user = text(body, 'user')
  if (/Reply with: ok/.test(user)) return 'ok'
  if (system.startsWith('You edit the words')) return /Make it shorter/.test(user) ? MOCK.shorten : /Translate it into/.test(user) ? MOCK.hindi : MOCK.rewrite
  if (/This is the section "/.test(user) && user.includes('```tsx')) return tweak(user)
  if (/You write ONE section/.test(system)) return section(user)
  return '{}'
}

export function startAiMock(port = AI_MOCK_PORT): Promise<{ calls: MockCall[]; close: () => Promise<void> }> {
  const calls: MockCall[] = []
  const json = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', c => (raw += c))
    req.on('end', () => {
      const path = (req.url ?? '/').split('?')[0]
      let body: MockCall['body'] = {}
      try {
        body = raw ? JSON.parse(raw) : {}
      } catch {
        /* not JSON */
      }
      calls.push({ path, body })
      if (path === '/healthz') return json(res, 200, { ok: true })
      if (path === '/v1/providers') return json(res, 200, { text: [{ name: 'anthropic', configured: true, keyFallback: true }], defaults: { text: ['anthropic'] } })
      if (path === '/v1/chat') return json(res, 200, { content: answer(body), provider: 'anthropic', model: 'mock-claude', latencyMs: 5, fallbackUsed: false, usage: { promptTokens: 100, completionTokens: 50, costInr: 0 } })
      if (path === '/v1/images/stock') return json(res, 200, { results: [] })
      json(res, 503, { error: 'not in the AI mock' })
    })
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, () => resolve({ calls, close: () => new Promise(r => server.close(() => r())) }))
  })
}
