import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { aiChat } from '@/lib/ai-client'
import { parseBody } from '@/lib/validate'

const Schema = z.object({
  productName: z.string().min(1).max(200),
  rating: z.number().int().min(1).max(5),
  tags: z.array(z.string().max(50)).max(8),
})

const RATING_FEEL: Record<number, string> = {
  1: 'very disappointed',
  2: 'not impressed',
  3: 'okay, mixed feelings',
  4: 'quite happy',
  5: 'really happy',
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const parsed = parseBody(Schema, body)
    if (!parsed.ok) return parsed.response

    const { productName, rating, tags } = parsed.data
    const feel = RATING_FEEL[rating]
    const tagLine = tags.length > 0 ? `The customer selected these aspects: ${tags.join(', ')}.` : ''

    const prompt = `You are helping an Indian online shopper write a product review. Write a short, genuine customer review for the product "${productName}".

Rules:
- The customer is ${feel} with the product (${rating}/5 stars)
- ${tagLine}
- Write like a real Indian person typing casually — include minor grammar imperfections, occasional missing articles ("the", "a"), run-on sentences, informal phrasing
- Mix English with how Indians naturally speak (phrases like "only", "na", "actually", "tbh", "overall good product" style)
- 2–4 sentences max
- Do NOT use hashtags, bullet points, or markdown
- Do NOT start with "I" — vary the opening
- Return ONLY the review text, nothing else`

    const result = await aiChat({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.9,
      maxTokens: 150,
      modelHint: 'copy',
    })

    return NextResponse.json({ review: result.content.trim() })
  } catch (err) {
    console.error('[route]', err)
    return NextResponse.json({ error: 'Failed to generate review' }, { status: 500 })
  }
}
