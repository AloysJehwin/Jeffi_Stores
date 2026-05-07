import { NextRequest, NextResponse } from 'next/server'
import { queryMany } from '@/lib/db'
import { computeShipmentDims, ShipmentItem, PackageType } from '@/lib/shipping'

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

    const variantIds: string[] = cartItems.filter((i: any) => i.variantId).map((i: any) => i.variantId)
    const productIds: string[] = cartItems.filter((i: any) => !i.variantId).map((i: any) => i.productId)

    const shipmentItems: ShipmentItem[] = []

    if (variantIds.length > 0) {
      const variants = await queryMany(
        `SELECT pv.id, pv.variant_name,
                COALESCE(pv.weight_grams, p.weight_grams, 500) AS weight_grams,
                COALESCE(pv.package_type, p.package_type) AS package_type,
                COALESCE(pv.length_cm, p.length_cm) AS length_cm,
                COALESCE(pv.breadth_cm, p.breadth_cm) AS breadth_cm,
                COALESCE(pv.height_cm, p.height_cm) AS height_cm
         FROM product_variants pv
         JOIN products p ON p.id = pv.product_id
         WHERE pv.id = ANY($1::uuid[])`,
        [variantIds]
      )
      for (const item of cartItems.filter((i: any) => i.variantId)) {
        const v = (variants || []).find((r: any) => r.id === item.variantId)
        if (v) {
          shipmentItems.push({
            packageType: (v.package_type as PackageType) || null,
            weightGrams: parseFloat(v.weight_grams) || 500,
            quantity: item.quantity || 1,
            storedDims: {
              length_cm:  v.length_cm  ? parseFloat(v.length_cm)  : null,
              breadth_cm: v.breadth_cm ? parseFloat(v.breadth_cm) : null,
              height_cm:  v.height_cm  ? parseFloat(v.height_cm)  : null,
            },
            variantName: v.variant_name,
          })
        }
      }
    }

    if (productIds.length > 0) {
      const products = await queryMany(
        `SELECT id, weight_grams, package_type, length_cm, breadth_cm, height_cm
         FROM products WHERE id = ANY($1::uuid[])`,
        [productIds]
      )
      for (const item of cartItems.filter((i: any) => !i.variantId)) {
        const p = (products || []).find((r: any) => r.id === item.productId)
        if (p) {
          shipmentItems.push({
            packageType: (p.package_type as PackageType) || null,
            weightGrams: parseFloat(p.weight_grams) || 500,
            quantity: item.quantity || 1,
            storedDims: {
              length_cm:  p.length_cm  ? parseFloat(p.length_cm)  : null,
              breadth_cm: p.breadth_cm ? parseFloat(p.breadth_cm) : null,
              height_cm:  p.height_cm  ? parseFloat(p.height_cm)  : null,
            },
          })
        }
      }
    }

    if (shipmentItems.length === 0) {
      return NextResponse.json({ error: 'No valid cart items' }, { status: 400 })
    }

    const dims = computeShipmentDims(shipmentItems)

    const params = new URLSearchParams({
      md: 'S',
      ss: 'Delivered',
      d_pin: destinationPin,
      o_pin: ORIGIN_PIN,
      cgm: String(dims.chargedWeightGrams),
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
