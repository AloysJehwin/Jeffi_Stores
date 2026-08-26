// AI caption generation for social posts left blank at publish time — used by
// publisher.ts so scheduled/cron posts get a real caption even with no admin present
// to click the AIEnrichButton in the composer. Mirrors ai-generate-email's Ollama
// call shape (single /api/generate prompt, JSON mode, truncation-tolerant parse).

const OLLAMA_URL = () =>
  (process.env.OLLAMA_BASE_URL || 'http://100.82.208.8:11434').replace(/\/$/, '')
const OLLAMA_MODEL = () => process.env.OLLAMA_EMAIL_MODEL || 'gemma3:4b'
const GENERATE_TIMEOUT_MS = 30_000

const SYSTEM_PROMPT = `You write short social media captions for Jeffi Stores, an Indian hardware & tools store.
Return ONLY valid JSON: {"caption":"<caption text>"}

RULES:
- 1-3 short sentences, friendly and direct, no corporate tone.
- No hashtags (added separately).
- No markdown, no emoji spam — at most one emoji if it fits naturally.
- Mention the product name naturally in the text.
- Do not invent specs, prices, or claims not given to you.`

/** Generate a short caption from a product's name/description. Returns '' on any failure. */
export async function generateSocialCaption(opts: { productName: string; productDescription?: string | null }): Promise<string> {
  const userPrompt = [
    `Product: ${opts.productName}`,
    opts.productDescription ? `Description: ${opts.productDescription}` : null,
  ].filter(Boolean).join('\n')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS)
  try {
    const res = await fetch(`${OLLAMA_URL()}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: OLLAMA_MODEL(),
        prompt: `${SYSTEM_PROMPT}\n\nUser: ${userPrompt}\n\nAssistant:`,
        stream: false,
        format: 'json',
        options: { temperature: 0.4, num_predict: 300 },
      }),
    })
    if (!res.ok) return ''
    const data = await res.json() as { response?: string }
    return extractCaption((data.response || '').trim())
  } catch {
    return ''
  } finally {
    clearTimeout(timeout)
  }
}

function extractCaption(raw: string): string {
  if (!raw) return ''

  const tryParse = (s: string): string | null => {
    try {
      const obj = JSON.parse(s) as { caption?: unknown }
      const c = typeof obj.caption === 'string' ? obj.caption.trim() : ''
      return c || null
    } catch {
      return null
    }
  }

  let caption = tryParse(raw)
  if (caption) return caption

  const stripped = raw.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim()
  caption = tryParse(stripped)
  if (caption) return caption

  const match = stripped.match(/\{[\s\S]*\}/)
  if (match) {
    caption = tryParse(match[0])
    if (caption) return caption
  }

  const keyed = stripped.match(/"caption"\s*:\s*"([\s\S]*)$/)
  if (keyed) {
    let val = keyed[1].replace(/"\s*\}?\s*$/, '')
    try {
      return String(JSON.parse(`"${val.replace(/"/g, '\\"')}"`)).trim()
    } catch {
      return val.trim()
    }
  }

  return ''
}
