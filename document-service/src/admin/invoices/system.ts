// Monolith-originated calls with no admin session (checkout, webhooks, subscription cycles).
import { withTransaction } from '@jeffi/tenancy'
import { NextResponse, type NextRequest } from '../../next'
import { createDraftInvoice, assignInvoiceNumber, generateOrderInvoice } from '../../lib/invoice'

const idOf = async (ctx: { params: Promise<{ id: string }> }) => (await ctx.params).id

export async function draft(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await createDraftInvoice(await idOf(ctx))
  return NextResponse.json({ ok: true })
}

export async function number(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const id = await idOf(ctx)
  const r = await withTransaction(client => assignInvoiceNumber(client, id))
  return NextResponse.json({ ok: true, invoice_number: r })
}

export async function generate(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const pdf = await generateOrderInvoice(await idOf(ctx))
  if (!pdf) return new NextResponse(null, { status: 204 })
  return new NextResponse(new Uint8Array(pdf), { headers: { 'content-type': 'application/pdf', 'content-length': String(pdf.length) } })
}
