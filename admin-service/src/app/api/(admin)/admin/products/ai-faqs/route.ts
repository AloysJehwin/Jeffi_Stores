export const maxDuration = 120

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { aiChat } from '@/lib/shared/ai-client'
import { aiDenial, parseAiJson } from '@/lib/auth/ai-scope'
import { storeDescriptorForPrompt } from '@/lib/catalog/brand'

// POST { context, details?, existing?: string[], count? } → { faqs: [{ question, answer }] }
export async function POST(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const denied = aiDenial(admin.role, admin.scopes, 'products:write')
  if (denied) return NextResponse.json({ error: denied }, { status: 403 })

  const body = await req.json().catch(() => null)
  const context = String(body?.context || '').trim()
  if (context.length < 3) return NextResponse.json({ error: 'Enter the product name first' }, { status: 400 })
  const details = String(body?.details || '').slice(0, 3000)
  const existing: string[] = Array.isArray(body?.existing) ? body.existing.map(String).slice(0, 30) : []
  const count = Math.min(8, Math.max(1, Number(body?.count) || 5))

  try {
    const r = await aiChat({
      feature: 'enrichment',
      modelHint: 'enrich',
      jsonMode: true,
      temperature: 0.4,
      noCache: true,
      messages: [
        {
          role: 'system',
          content: `You write product page FAQs for ${await storeDescriptorForPrompt()}.
Write ${count} questions a buyer would really ask before purchasing, with short factual answers (1-3 sentences).
Use only facts given in the product details; where a fact is missing, answer generally or point the buyer to the specifications or support — never invent ratings, certifications, prices or delivery promises.
Do not repeat the questions already listed. Return only JSON {"faqs":[{"question":"…","answer":"…"}]}.`,
        },
        {
          role: 'user',
          content: [context, details && `Details:\n${details}`, existing.length ? `Already answered:\n- ${existing.join('\n- ')}` : '']
            .filter(Boolean)
            .join('\n\n'),
        },
      ],
    })
    const raw = parseAiJson<{ faqs?: { question?: unknown; answer?: unknown }[] }>(r.content)?.faqs
    const seen = new Set(existing.map(q => q.trim().toLowerCase()))
    const faqs = (Array.isArray(raw) ? raw : [])
      .map(f => ({ question: String(f?.question ?? '').trim().slice(0, 300), answer: String(f?.answer ?? '').trim().slice(0, 2000) }))
      .filter(f => f.question && f.answer && !seen.has(f.question.toLowerCase()))
      .slice(0, count)
    if (!faqs.length) return NextResponse.json({ error: 'AI returned no usable questions — try again' }, { status: 502 })
    return NextResponse.json({ faqs })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'AI service error' }, { status: err?.status ?? 503 })
  }
}
