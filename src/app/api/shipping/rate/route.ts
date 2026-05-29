import { NextRequest, NextResponse } from 'next/server'
import { queryMany } from '@/lib/db'
import {
  packIntoCartons,
  fallbackShippingRate,
  ShipmentItem,
  PackageType,
  CARTON_MAX_WEIGHT_GRAMS,
} from '@/lib/shipping'
import { getDeliverySettings, applyDeliveryRules } from '@/lib/delivery-settings'

const DELHIVERY_API = 'https://track.delhivery.com/api/kinko/v1/invoice/charges/.json'
const ORIGIN_PIN = process.env.DELHIVERY_ORIGIN_PINCODE || '492001'
const TOKEN = process.env.DELHIVERY_API_KEY
const SHIPPING_MIN_CHARGE = parseFloat(process.env.SHIPPING_MIN_CHARGE || '0') || 0
const COD_SURCHARGE_FLAT = parseFloat(process.env.COD_SURCHARGE_FLAT || '40') || 40
const COD_SURCHARGE_PCT = parseFloat(process.env.COD_SURCHARGE_PCT || '2') || 2

interface RateBreakdown {
  charge: number
  zone: string
  source: 'delhivery' | 'fallback' | 'free' | 'admin_disabled' | 'free_threshold'
  chargedWeightGrams: number
  cartonCount: number
  cartons?: { weightGrams: number; charge: number; zone: string }[]
  freeShippingThreshold?: number
}

async function callDelhiveryForCarton(weightGrams: number, destinationPin: string, isCod: boolean) {
  const params = new URLSearchParams({
    md: 'S',
    ss: 'Delivered',
    d_pin: destinationPin,
    o_pin: ORIGIN_PIN,
    cgm: String(weightGrams),
    pt: isCod ? 'COD' : 'Pre-paid',
    cod: isCod ? '0' : '0',
  })
  const res = await fetch(`${DELHIVERY_API}?${params}`, {
    headers: {
      Authorization: `Token ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    next: { revalidate: 0 },
  })
  if (!res.ok) throw new Error(`Delhivery ${res.status}`)
  const data = await res.json()
  const rate = Array.isArray(data) ? data[0] : data
  if (!rate || rate.error || rate.total_amount == null) throw new Error(rate?.error || 'no rate')
  return {
    charge: Number(rate.total_amount),
    zone: String(rate.zone || ''),
    chargedWeight: Number(rate.charged_weight) || weightGrams,
  }
}

export async function POST(request: NextRequest) {
  try {
    const { destinationPin, cartItems, subtotal, isCod } = await request.json()

    if (!destinationPin || !/^\d{6}$/.test(destinationPin)) {
      return NextResponse.json({ error: 'Invalid destination pincode' }, { status: 400 })
    }

    const variantIds: string[] = (cartItems || []).filter((i: any) => i.variantId).map((i: any) => i.variantId)
    const productIds: string[] = (cartItems || []).filter((i: any) => !i.variantId).map((i: any) => i.productId)

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
        `SELECT id, name, weight_grams, package_type, length_cm, breadth_cm, height_cm
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
            variantName: p.name,
          })
        }
      }
    }

    if (shipmentItems.length === 0) {
      return NextResponse.json({ error: 'No valid cart items' }, { status: 400 })
    }

    const deliverySettings = await getDeliverySettings()
    const totalWeightGrams = shipmentItems.reduce((s, i) => s + i.weightGrams * i.quantity, 0)

    if (!deliverySettings.enabled) {
      return NextResponse.json<RateBreakdown>({
        charge: 0,
        zone: 'Free',
        source: 'admin_disabled',
        chargedWeightGrams: totalWeightGrams,
        cartonCount: 0,
      })
    }

    if (deliverySettings.freeThreshold > 0 && typeof subtotal === 'number' && subtotal >= deliverySettings.freeThreshold) {
      return NextResponse.json<RateBreakdown>({
        charge: 0,
        zone: 'Free',
        source: 'free_threshold',
        chargedWeightGrams: totalWeightGrams,
        cartonCount: 0,
        freeShippingThreshold: deliverySettings.freeThreshold,
      })
    }

    const cartons = packIntoCartons(shipmentItems, CARTON_MAX_WEIGHT_GRAMS)

    let totalCharge = 0
    let totalChargedWeight = 0
    let zone = ''
    let source: 'delhivery' | 'fallback' = 'delhivery'
    const cartonBreakdown: RateBreakdown['cartons'] = []

    if (TOKEN) {
      try {
        for (const c of cartons) {
          const r = await callDelhiveryForCarton(c.chargedWeightGrams, destinationPin, !!isCod)
          totalCharge += r.charge
          totalChargedWeight += r.chargedWeight
          zone = r.zone || zone
          cartonBreakdown.push({ weightGrams: c.chargedWeightGrams, charge: r.charge, zone: r.zone })
        }
      } catch {
        source = 'fallback'
        totalCharge = 0
        totalChargedWeight = 0
        cartonBreakdown.length = 0
      }
    } else {
      source = 'fallback'
    }

    if (source === 'fallback') {
      for (const c of cartons) {
        const r = fallbackShippingRate({
          chargedWeightGrams: c.chargedWeightGrams,
          destinationPin,
          originPin: ORIGIN_PIN,
          cartonCount: cartons.length,
        })
        totalCharge += r.charge
        totalChargedWeight += c.chargedWeightGrams
        zone = r.zone
        cartonBreakdown.push({ weightGrams: c.chargedWeightGrams, charge: r.charge, zone: r.zone })
      }
    }

    if (SHIPPING_MIN_CHARGE > 0 && totalCharge > 0 && totalCharge < SHIPPING_MIN_CHARGE) {
      totalCharge = SHIPPING_MIN_CHARGE
    }

    if (isCod) {
      const codFee = typeof subtotal === 'number'
        ? Math.max(COD_SURCHARGE_FLAT, (COD_SURCHARGE_PCT / 100) * subtotal)
        : COD_SURCHARGE_FLAT
      totalCharge += codFee
    }

    const baseCharge = Math.round(totalCharge * 100) / 100
    const ruleResult = applyDeliveryRules({
      baseCharge,
      subtotal: typeof subtotal === 'number' ? subtotal : 0,
      settings: deliverySettings,
    })

    const result: RateBreakdown = {
      charge: ruleResult.charge,
      zone,
      source: ruleResult.source === 'as_is' || ruleResult.source === 'discounted' ? source : ruleResult.source,
      chargedWeightGrams: totalChargedWeight,
      cartonCount: cartons.length,
      cartons: cartonBreakdown,
    }
    if (deliverySettings.freeThreshold > 0) result.freeShippingThreshold = deliverySettings.freeThreshold

    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
