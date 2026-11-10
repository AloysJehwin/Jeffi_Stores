import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { actorOf } from '@/lib/admin/draft-locks'
import { deleteCategoryRow, discardReply } from '@/lib/admin/discard-rows'

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await requireAdminScope(request, 'categories:write')
    if (admin instanceof NextResponse) return admin

    return discardReply(await deleteCategoryRow(actorOf(admin), id))
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to delete category' }, { status: 500 })
  }
}
