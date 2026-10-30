import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { parseBody } from '@/lib/shared/validate'
import { atLeast, folderLevel } from '@/lib/drive/access'
import { createFolder } from '@/lib/drive/folders'
import { driveActor, driveFailure } from '@/lib/drive/http'

export const dynamic = 'force-dynamic'

const schema = z.object({
  parentId: z.string().uuid().nullish(),
  name: z.string().trim().min(1).max(160),
  visibility: z.enum(['private', 'team', 'shared']).default('private'),
})

export async function POST(request: NextRequest) {
  const actor = await driveActor(request, 'drive:write')
  if (actor instanceof NextResponse) return actor
  const parsed = parseBody(schema, await request.json().catch(() => ({})))
  if (!parsed.ok) return parsed.response
  try {
    const parentId = parsed.data.parentId ?? null
    if (parentId && !atLeast(await folderLevel(actor, parentId), 'edit')) return NextResponse.json({ error: 'You cannot add folders here' }, { status: 403 })
    return NextResponse.json({ folder: await createFolder(actor, { parentId, name: parsed.data.name, visibility: parsed.data.visibility }) })
  } catch (err) {
    return driveFailure(err, 'Creating the folder')
  }
}
