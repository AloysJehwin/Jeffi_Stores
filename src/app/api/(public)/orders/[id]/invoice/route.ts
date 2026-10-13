import { NextRequest } from 'next/server'
import { proxyUserOrAdminDocs } from '@/lib/documents/proxy'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return proxyUserOrAdminDocs(request, `/orders/${id}/invoice`)
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return proxyUserOrAdminDocs(request, `/orders/${id}/invoice`)
}
