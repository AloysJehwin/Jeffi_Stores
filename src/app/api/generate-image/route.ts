import { NextRequest, NextResponse } from 'next/server'
import Replicate from 'replicate'
import { authenticateAdmin } from '@/lib/jwt'
import { aiDenial } from '@/lib/ai-scope'

export const dynamic = 'force-dynamic'

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })

export async function POST(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const denied = aiDenial(admin.role, admin.scopes, 'settings:write')
  if (denied) return NextResponse.json({ error: denied }, { status: 403 })

  if (!process.env.REPLICATE_API_TOKEN) {
    return NextResponse.json({ error: 'REPLICATE_API_TOKEN not configured' }, { status: 500 })
  }

  const body = await req.json()
  const { prompt, width = 1024, height = 1024, model = 'schnell' } = body

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return NextResponse.json({ error: 'prompt is required' }, { status: 400 })
  }

  const modelMap: Record<string, `${string}/${string}` | `${string}/${string}:${string}`> = {
    schnell: 'black-forest-labs/flux-schnell',
    dev: 'black-forest-labs/flux-dev',
    pro: 'black-forest-labs/flux-pro',
  }
  const replicateModel = modelMap[model] ?? modelMap.schnell

  try {
    const output = await replicate.run(replicateModel, {
      input: {
        prompt: prompt.trim(),
        width: Math.min(Math.max(256, width), 1440),
        height: Math.min(Math.max(256, height), 1440),
        num_outputs: 1,
      },
    })

    // Flux returns an array of URLs or ReadableStream objects
    const urls: string[] = []
    for (const item of output as any[]) {
      if (typeof item === 'string') {
        urls.push(item)
      } else if (item?.url) {
        urls.push(typeof item.url === 'function' ? await item.url() : item.url)
      }
    }

    return NextResponse.json({ urls })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Generation failed' }, { status: 500 })
  }
}
