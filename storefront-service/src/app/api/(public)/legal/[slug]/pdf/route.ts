import { NextResponse } from 'next/server'
import { getStorePolicyBySlug, getStoreLegalContext, policyPdfName, storeSealForPdf } from '@/lib/legals/store-policies'
import { generatePolicyPDF } from '@/lib/documents/policy-pdf'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const policy = await getStorePolicyBySlug(slug)
  if (!policy) return new NextResponse('Not found', { status: 404 })

  try {
    const ctx = await getStoreLegalContext()
    const seal = await storeSealForPdf(ctx)
    const pdf = await generatePolicyPDF(policy, seal === undefined ? undefined : { seal })
    const fileName = policyPdfName(ctx.slug, policy.slug)
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
