import { aiChat } from '@/lib/shared/ai-client'
import { AI_ADMIN_SCOPE } from '@/lib/auth/ai-scope'
import { fitHashtags } from './providers/types'

// AI hashtag suggestions for a caption, returned as #words (the composer trims them per network).

export function parseHashtags(raw: string): string[] {
  const body = raw.replace(/^```\w*\n?|\n?```$/g, '')
  try {
    const j = JSON.parse(body.match(/\{[\s\S]*\}/)?.[0] ?? body)
    if (Array.isArray(j?.hashtags)) return fitHashtags(j.hashtags.map((t: unknown) => `#${String(t).replace(/^#/, '').replace(/\s+/g, '')}`).join(' '), 30).split(' ').filter(Boolean)
  } catch {}
  return fitHashtags(body, 30).split(' ').filter(Boolean)
}

export async function suggestHashtags(text: string, count = 15): Promise<string[]> {
  const { currentTenantPlanGate } = await import('@/lib/auth/plan-gate')
  if (!(await currentTenantPlanGate(AI_ADMIN_SCOPE)).allowed) throw Object.assign(new Error('AI suggestions need a plan with AI'), { status: 403 })
  const { storeDescriptorForPrompt } = await import('@/lib/catalog/brand')
  const r = await aiChat({
    feature: 'social_hashtags',
    modelHint: 'email',
    jsonMode: true,
    temperature: 0.4,
    maxTokens: 300,
    messages: [
      {
        role: 'system',
        content: `You suggest social media hashtags for ${await storeDescriptorForPrompt()}, a store in India.
Return ONLY valid JSON: {"hashtags":["word", ...]}
RULES:
- ${count} hashtags, most specific first: product, category, use, then 2-3 broader ones.
- One word each, letters and digits only, no spaces, no # sign.
- No banned or spammy tags (follow4follow, like4like and similar).`,
      },
      { role: 'user', content: text.slice(0, 2000) },
    ],
  })
  return parseHashtags(r.content.trim()).slice(0, count)
}
