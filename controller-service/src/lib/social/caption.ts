// AI caption generation for social posts left blank at publish time — used by
// publisher.ts so scheduled/cron posts get a real caption even with no admin present
// to click the AIEnrichButton in the composer. Goes through the ai-platform gateway
// (JSON mode, truncation-tolerant parse).

import { aiChat } from '@/lib/shared/ai-client'
import { AI_ADMIN_SCOPE } from '@/lib/auth/ai-scope'

const SYSTEM_PROMPT = (store: string) => `You write short social media captions for ${store}.
Return ONLY valid JSON: {"caption":"<caption text>"}

RULES:
- 1-3 short sentences, friendly and direct, no corporate tone.
- No hashtags (added separately).
- No markdown and no emojis.
- Mention the product name naturally in the text.
- Do not invent specs, prices, or claims not given to you.`

/** Generate a short caption from a product's name/description. Returns '' on any failure. */
export async function generateSocialCaption(opts: {
  productName: string
  productDescription?: string | null
}): Promise<string> {
  const userPrompt = [
    `Product: ${opts.productName}`,
    opts.productDescription ? `Description: ${opts.productDescription}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  try {
    const { currentTenantPlanGate } = await import('@/lib/auth/plan-gate')
    if (!(await currentTenantPlanGate(AI_ADMIN_SCOPE)).allowed) return ''
    const { storeDescriptorForPrompt } = await import('@/lib/catalog/brand')
    const r = await aiChat({
      modelHint: 'email',
      jsonMode: true,
      temperature: 0.4,
      maxTokens: 300,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT(await storeDescriptorForPrompt()) },
        { role: 'user', content: userPrompt },
      ],
    })
    return extractCaption(r.content.trim())
  } catch {
    return ''
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

  const stripped = raw
    .replace(/^```[\w]*\n?/, '')
    .replace(/\n?```$/, '')
    .trim()
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
