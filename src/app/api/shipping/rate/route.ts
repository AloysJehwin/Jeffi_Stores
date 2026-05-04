import { NextRequest, NextResponse } from 'next/server'
import { queryMany } from '@/lib/db'

const DELHIVERY_API = 'https://track.delhivery.com/api/kinko/v1/invoice/charges/.json'
const ORIGIN_PIN = process.env.DELHIVERY_ORIGIN_PINCODE || '492001'
const TOKEN = process.env.DELHIVERY_API_KEY

export async function POST(request: NextRequest) {
  try {
    const { destinationPin, cartItems } = await request.json()

    if (!destinationPin || !/^\d{6}$/.test(destinationPin)) {
      return NextResponse.json({ error: 'Invalid destination pincode' }, { status: 400 })
    }

    if (!TOKEN) {
      return NextResponse.json({ error: 'Shipping service not configured' }, { status: 503 })
    }

    const variantIds: string[] = cartItems
      .filter((i: any) => i.variantId)
      .map((i: any) => i.variantId)
    const productIds: string[] = cartItems
      .filter((i: any) => !i.variantId)
      .map((i: any) => i.productId)

    let totalWeightGrams = 0
    let maxLength = 0
    let maxBreadth = 0
    let maxHeight = 0

    if (variantIds.length > 0) {
      const variants = await queryMany(
        `SELECT pv.id, pv.weight_grams, pv.length_cm, pv.breadth_cm, pv.height_cm
         FROM product_variants pv WHERE pv.id = ANY($1::uuid[])`,
        [variantIds]
      )
      for (const item of cartItems.filter((i: any) => i.variantId)) {
        const v = (variants || []).find((r: any) => r.id === item.variantId)
        if (v) {
          totalWeightGrams += (v.weight_grams || 500) * (item.quantity || 1)
          if ((v.length_cm || 10) > maxLength) maxLength = parseFloat(v.length_cm) || 10
          if ((v.breadth_cm || 10) > maxBreadth) maxBreadth = parseFloat(v.breadth_cm) || 10
          if ((v.height_cm || 10) > maxHeight) maxHeight = parseFloat(v.height_cm) || 10
        }
      }
    }

    if (productIds.length > 0) {
      const products = await queryMany(
        `SELECT id, weight_grams, length_cm, breadth_cm, height_cm FROM products WHERE id = ANY($1::uuid[])`,
        [productIds]
      )
      for (const item of cartItems.filter((i: any) => !i.variantId)) {
        const p = (products || []).find((r: any) => r.id === item.productId)
        if (p) {
          totalWeightGrams += (p.weight_grams || 500) * (item.quantity || 1)
          if ((p.length_cm || 10) > maxLength) maxLength = parseFloat(p.length_cm) || 10
          if ((p.breadth_cm || 10) > maxBreadth) maxBreadth = parseFloat(p.breadth_cm) || 10
          if ((p.height_cm || 10) > maxHeight) maxHeight = parseFloat(p.height_cm) || 10
        }
      }
    }

    const weightGrams = Math.max(totalWeightGrams, 1)

    const params = new URLSearchParams({
      md: 'S',
      ss: 'Delivered',
      d_pin: destinationPin,
      o_pin: ORIGIN_PIN,
      cgm: String(weightGrams),
      pt: 'Pre-paid',
      cod: '0',
    })

    const res = await fetch(`${DELHIVERY_API}?${params}`, {
      headers: {
        Authorization: `Token ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      next: { revalidate: 0 },
    })

    if (!res.ok) {
      return NextResponse.json({ error: 'Shipping rate unavailable' }, { status: 502 })
    }

    const data = await res.json()
    const rate = Array.isArray(data) ? data[0] : data

    if (!rate || rate.error) {
      return NextResponse.json({ error: 'Could not calculate shipping for this pincode' }, { status: 422 })
    }

    return NextResponse.json({
      charge: Math.round(rate.total_amount * 100) / 100,
      zone: rate.zone,
      chargedWeightGrams: rate.charged_weight,
    })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
