import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { revalidatePath } from 'next/cache'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'categories:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const form = await req.formData()
  const variant = form.get('variant') as 'mobile' | 'desktop'
  const file = form.get('file') as File | null

  if (!variant || !['mobile', 'desktop'].includes(variant)) {
    return NextResponse.json({ error: 'variant must be mobile or desktop' }, { status: 400 })
  }
  if (!file) return NextResponse.json({ error: 'file required' }, { status: 400 })

  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
  if (!['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
    return NextResponse.json({ error: 'Only jpg/png/webp allowed' }, { status: 400 })
  }

  const dir = join(process.cwd(), 'public', 'images', 'categories')
  await mkdir(dir, { recursive: true })

  // Get slug for filename
  const cat = await import('@/lib/db').then(m => m.queryOne<{ slug: string }>('SELECT slug FROM categories WHERE id = $1', [id]))
  if (!cat) return NextResponse.json({ error: 'Category not found' }, { status: 404 })

  const filename = `${cat.slug}-${variant}.${ext}`
  const dest = join(dir, filename)
  await writeFile(dest, Buffer.from(await file.arrayBuffer()))

  const publicPath = `/images/categories/${filename}`
  const col = variant === 'mobile' ? 'hero_image_mobile' : 'hero_image_desktop'
  await query(`UPDATE categories SET ${col} = $1, updated_at = NOW() WHERE id = $2`, [publicPath, id])

  revalidatePath('/')
  revalidatePath('/admin/categories')

  return NextResponse.json({ path: publicPath })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'categories:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { variant } = await req.json()
  if (!variant || !['mobile', 'desktop'].includes(variant)) {
    return NextResponse.json({ error: 'variant must be mobile or desktop' }, { status: 400 })
  }

  const col = variant === 'mobile' ? 'hero_image_mobile' : 'hero_image_desktop'
  await query(`UPDATE categories SET ${col} = NULL, updated_at = NOW() WHERE id = $1`, [id])

  revalidatePath('/')
  revalidatePath('/admin/categories')

  return NextResponse.json({ ok: true })
}
