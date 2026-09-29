import { NextResponse } from 'next/server'
import { getPolicyBySlug } from '@/lib/legals/policies'
import { generatePolicyPDF } from '@/lib/policy-pdf'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const policy = getPolicyBySlug(slug)
  if (!policy) return new NextResponse('Not found', { status: 404 })

  try {
    const pdf = await generatePolicyPDF(policy)
    const fileName = `jeffistores-${policy.slug}.pdf`
    return new NextResponse(pdf as any, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${fileName}"`,
        'Content-Length': String(pdf.length),
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch (err) {
    return NextResponse.json({ error: 'Failed to generate PDF' }, { status: 500 })
  }
}
