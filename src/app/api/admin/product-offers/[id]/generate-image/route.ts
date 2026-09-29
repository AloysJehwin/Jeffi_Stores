import { NextRequest, NextResponse } from 'next/server'
import Replicate from 'replicate'
import { authenticateAdmin } from '@/lib/jwt'
import { aiDenial } from '@/lib/ai-scope'
import { query, queryOne } from '@/lib/db'
import { uploadGalleryImage } from '@/lib/s3'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })

// POST /api/admin/product-offers/[id]/generate-image
// Body: { prompt: string, field?: 'image_url' | 'image_url_mobile' }
// Generates an offer card image with Flux, persists it to S3, and saves the URL on the offer.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const denied = aiDenial(admin.role, admin.scopes, 'coupons:write')
    if (denied) return NextResponse.json({ error: denied }, { status: 403 })
    if (!process.env.REPLICATE_API_TOKEN) {
      return NextResponse.json({ error: 'Image generation is not configured (REPLICATE_API_TOKEN missing).' }, { status: 500 })
    }

    const offer = await queryOne<{ id: string }>(`SELECT id FROM product_offers WHERE id = $1`, [id])
    if (!offer) return NextResponse.json({ error: 'Offer not found' }, { status: 404 })

    const body = await request.json().catch(() => ({}))
    const rawPrompt = typeof body?.prompt === 'string' ? body.prompt.trim() : ''
    if (rawPrompt.length < 3) return NextResponse.json({ error: 'Describe the scene you want (a few words at least).' }, { status: 400 })
    const field = body?.field === 'image_url_mobile' ? 'image_url_mobile' : 'image_url'

    const prompt = `${rawPrompt}. Professional promotional offer banner, cinematic studio lighting, dark near-black background, subject composed toward the right side leaving negative space on the left for text, high detail, photorealistic, 16:9 wide banner.`

    const output = await replicate.run('black-forest-labs/flux-dev', {
      input: { prompt, width: 1440, height: 640, num_outputs: 1, aspect_ratio: '16:9' },
    })

    // Flux returns an array of URLs or file-like objects exposing .url()
    let genUrl = ''
    for (const item of output as any[]) {
      if (typeof item === 'string') { genUrl = item; break }
      if (item?.url) { genUrl = typeof item.url === 'function' ? await item.url() : item.url; break }
    }
    if (!genUrl) return NextResponse.json({ error: 'Model returned no image' }, { status: 502 })

    // Fetch the generated image and persist it to our own S3 (Replicate URLs expire).
    const imgRes = await fetch(genUrl)
    if (!imgRes.ok) return NextResponse.json({ error: 'Failed to fetch generated image' }, { status: 502 })
    const buffer = Buffer.from(await imgRes.arrayBuffer())
    const { url, blurhash } = await uploadGalleryImage(buffer, `offer-${id}.png`)
    const hashField = field === 'image_url_mobile' ? 'blurhash_mobile' : 'blurhash'

    await query(
      `UPDATE product_offers SET ${field} = $1, ${hashField} = $2, updated_at = NOW() WHERE id = $3`,
      [url, blurhash, id],
    )
    return NextResponse.json({ url, field, blurhash })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Image generation failed' }, { status: 500 })
  }
}
