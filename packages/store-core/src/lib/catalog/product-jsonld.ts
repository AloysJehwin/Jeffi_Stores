import { humanizeLabel } from '@/lib/shared/format'
import { specValues } from '@/lib/catalog/product-specs'

// schema.org Product fields from the catalogue columns, shared by the storefront and business PDPs.

const CONDITION: Record<string, string> = {
  new: 'https://schema.org/NewCondition',
  refurbished: 'https://schema.org/RefurbishedCondition',
  used: 'https://schema.org/UsedCondition',
  open_box: 'https://schema.org/UsedCondition',
}

export const itemConditionLd = (p: any) => CONDITION[p?.condition] ?? CONDITION.new

const prop = (name: string, value: unknown) => {
  const v = value == null ? '' : String(value).trim()
  return v ? { '@type': 'PropertyValue', name, value: v.slice(0, 500) } : null
}

/** model, manufacturer, colour, origin and the spec table as additionalProperty. */
export function productExtrasLd(p: any): Record<string, unknown> {
  const props = [
    prop('Series', p.series),
    prop('Pack size', p.pack_size),
    Number(p.net_quantity) > 0 ? prop('Net quantity', `${Number(p.net_quantity)} ${p.net_quantity_unit ?? ''}`.trim()) : null,
    Number(p.warranty_months) > 0 ? prop('Warranty', `${Number(p.warranty_months)} months${p.warranty_type ? ` (${p.warranty_type})` : ''}`) : null,
    prop("What's in the box", String(p.in_the_box ?? '').split(/\n+/).map(l => l.trim()).filter(Boolean).join(', ')),
  ]
  if (p.specifications && typeof p.specifications === 'object' && !Array.isArray(p.specifications)) {
    for (const [k, v] of Object.entries(p.specifications).slice(0, 30)) props.push(prop(humanizeLabel(k), specValues(v).join(', ')))
  }
  const additionalProperty = props.filter(Boolean)
  return {
    ...(p.model_number && { model: p.model_number }),
    ...(p.manufacturer_name && { manufacturer: { '@type': 'Organization', name: p.manufacturer_name } }),
    ...(p.color && { color: p.color }),
    ...(p.material && { material: p.material }),
    ...(p.country_of_origin && { countryOfOrigin: { '@type': 'Country', name: p.country_of_origin } }),
    ...(additionalProperty.length > 0 && { additionalProperty }),
  }
}

/** The offer's return policy: the product's own window, else its brand's, else its category's. */
export function returnPolicyLd(p: any): Record<string, unknown> | undefined {
  const allowed = p?.categories?.return_allowed !== false && p?.brands?.return_allowed !== false
  if (!allowed) return { '@type': 'MerchantReturnPolicy', applicableCountry: 'IN', returnPolicyCategory: 'https://schema.org/MerchantReturnNotPermitted' }
  const days = [p?.return_window_days, p?.brands?.return_window_days, p?.categories?.return_window_days].map(Number).find(n => n > 0)
  if (!days) return undefined
  return {
    '@type': 'MerchantReturnPolicy',
    applicableCountry: 'IN',
    returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
    merchantReturnDays: days,
  }
}
