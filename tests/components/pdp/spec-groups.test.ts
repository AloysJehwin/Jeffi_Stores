import { describe, it, expect } from 'vitest'
import { buildSpecGroups, type SpecSource } from '@/components/visitor/pdp/spec-groups'

const build = (product: SpecSource) => buildSpecGroups(product)
const rowsOf = (product: SpecSource, groupId: string) =>
  build(product).groups.find(g => g.id === groupId)?.rows ?? []
const valueOf = (product: SpecSource, groupId: string, label: string) =>
  rowsOf(product, groupId).find(r => r.label === label)?.value
const allText = (product: SpecSource) =>
  build(product).groups.flatMap(g => g.rows.flatMap(r => [r.label, r.value])).join(' | ')

describe('buildSpecGroups', () => {
  it('is empty for a product with nothing to show', () => {
    expect(build({})).toEqual({ handling: [], groups: [] })
    expect(build({ brands: { name: null }, specifications: {}, condition: 'new', target_gender: 'unisex' }))
      .toEqual({ handling: [], groups: [] })
  })

  it('never shows packaging, logistics, variant or internal fields', () => {
    const product = {
      sku: 'GMF-912-M8',
      package_type: 'Blister Pack', length_cm: '12.00', breadth_cm: '8.00', height_cm: '3.00',
      weight_grams: 750, weight: '0.75', weight_unit: 'kg', variant_type: 'Length', sub_variant_type: 'Pack',
      currency: 'INR', asin: 'B0TESTASIN', categories: { name: 'Allen Screws' }, launch_date: '2026-01-01',
      tax_class: 'standard', shipping_class: 'oversized',
    } as SpecSource
    const text = allText(product)
    for (const hidden of ['Blister Pack', 'Package', 'Weight', '750', 'Variant', 'Length', 'INR', 'Currency', 'B0TESTASIN', 'ASIN', 'Allen Screws', 'Category', '2026', 'oversized']) {
      expect(text).not.toContain(hidden)
    }
    expect(build(product).groups.map(g => g.id)).toEqual(['codes'])
  })

  it('keeps groups in order and marks the SKU as copyable', () => {
    const groups = build({
      brands: { name: 'GMF' }, specifications: { 'Thread Type': 'Metric' }, compliance_standard: 'DIN 912',
      warranty_months: 12, sku: 'GMF-1',
    }).groups
    expect(groups.map(g => [g.id, g.title])).toEqual([
      ['key-details', 'Key details'],
      ['technical', 'Technical specifications'],
      ['standards', 'Standards and safety'],
      ['warranty', 'Warranty and origin'],
      ['codes', 'Product codes'],
    ])
    expect(groups[4].rows[0]).toEqual({ label: 'SKU', value: 'GMF-1', copy: true })
  })

  it('prefers the column and lets an aliased spec fill an empty column', () => {
    const product: SpecSource = {
      material: 'Stainless Steel 304',
      specifications: { Material: 'Steel', 'Surface Finish': 'Zinc Plated', material_grade: '8.8', Size: 'M10' },
    }
    expect(valueOf(product, 'key-details', 'Material')).toBe('Stainless Steel 304')
    expect(valueOf(product, 'key-details', 'Finish')).toBe('Zinc Plated')
    expect(valueOf(product, 'key-details', 'Grade')).toBe('8.8')
    expect(valueOf(product, 'key-details', 'Size')).toBe('M10')
  })

  it('does not repeat aliased or internal spec keys under technical specifications', () => {
    const product: SpecSource = {
      hsn_code: '7318',
      specifications: {
        Material: 'Steel', 'HSN Code': '7318', Standard: 'DIN 912', 'Part Number': 'P-1', Colour: 'Black',
        'Safety Rating': 'IP65', SKU: 'X-1', 'Package Type': 'Box', gst_rate: '18', Barcode: '890', MRP: '99',
        'Drive Size': '1/2"',
      },
    }
    expect(rowsOf(product, 'technical')).toEqual([{ label: 'Drive Size', value: '1/2"' }])
    expect(valueOf(product, 'key-details', 'Part number')).toBe('P-1')
    expect(valueOf(product, 'key-details', 'Color')).toBe('Black')
    expect(valueOf(product, 'standards', 'Safety rating')).toBe('IP65')
    expect(valueOf(product, 'codes', 'HSN code')).toBe('7318')
  })

  it('merges snake_case and Title Case keys, joins arrays and drops junk values', () => {
    const product: SpecSource = {
      specifications: {
        'Thread Size': 'M8', thread_size: 'M10', 'Point Types': ['Split', 'Standard'],
        Hardness: 'nan', Coating: '', Tolerance: 'null', 'Head Style': 'Socket',
      },
    }
    expect(rowsOf(product, 'technical')).toEqual([
      { label: 'Head Style', value: 'Socket' },
      { label: 'Point Types', value: 'Split, Standard' },
      { label: 'Thread Size', value: 'M8, M10' },
    ])
  })

  it('names the colour without a swatch (stored hex values do not match the names)', () => {
    const color = (product: SpecSource) => rowsOf(product, 'key-details').find(r => r.label === 'Color')
    expect(color({ color: 'Silver' })).toEqual({ label: 'Color', value: 'Silver' })
    expect(color({ specifications: { Colour: 'Red' } })).toEqual({ label: 'Color', value: 'Red' })
    expect(color({})).toBeUndefined()
  })

  it('promotes a Dimensions spec and hides a Category spec', () => {
    const product: SpecSource = { specifications: { Dimensions: '10 x 20 mm', Category: 'Hand Tools', Hardness: '36 HRc' } }
    expect(valueOf(product, 'key-details', 'Dimensions')).toBe('10 x 20 mm')
    expect(rowsOf(product, 'technical')).toEqual([{ label: 'Hardness', value: '36 HRc' }])
  })

  it('formats net weight, volume and dimensions', () => {
    const kd = (product: SpecSource, label: string) => valueOf(product, 'key-details', label)
    expect(kd({ net_weight_grams: 250 }, 'Net weight')).toBe('250 g')
    expect(kd({ net_weight_grams: 1000 }, 'Net weight')).toBe('1 kg')
    expect(kd({ net_weight_grams: 1500 }, 'Net weight')).toBe('1.5 kg')
    expect(kd({ net_weight_grams: 1234 }, 'Net weight')).toBe('1.23 kg')
    expect(kd({ net_weight_grams: 0 }, 'Net weight')).toBeUndefined()
    expect(kd({ volume_ml: '250.00' }, 'Volume')).toBe('250 ml')
    expect(kd({ volume_ml: '1000.00' }, 'Volume')).toBe('1 L')
    expect(kd({ volume_ml: 1500 }, 'Volume')).toBe('1.5 L')
    expect(kd({ dimensions: '105 x 1.0 x 16 mm' }, 'Dimensions')).toBe('105 x 1.0 x 16 mm')
  })

  it('lists digital details only for digital products', () => {
    const digital: SpecSource = { license_type: 'Commercial', file_format: 'PDF', platform_compatibility: ['Windows', 'macOS'] }
    expect(rowsOf(digital, 'key-details')).toEqual([])
    expect(rowsOf({ ...digital, is_digital: true }, 'key-details')).toEqual([
      { label: 'License', value: 'Commercial' },
      { label: 'File format', value: 'PDF' },
      { label: 'Works with', value: 'Windows, macOS' },
    ])
  })

  it('merges compliance chips from the column and aliased specs without repeats', () => {
    const product: SpecSource = {
      compliance_standard: 'IS 2269, DIN 912',
      certifications: ['ISI', 'CE'],
      specifications: { Standard: ['din 912', 'ISO 4762'], standard_compliance: 'ISO 4762, ASTM A193' },
    }
    const compliance = rowsOf(product, 'standards').find(r => r.label === 'Compliance')
    expect(compliance?.chips).toEqual(['IS 2269', 'DIN 912', 'ISO 4762', 'ASTM A193'])
    expect(compliance?.value).toBe('IS 2269, DIN 912, ISO 4762, ASTM A193')
    expect(rowsOf(product, 'standards').find(r => r.label === 'Certifications')?.chips).toEqual(['ISI', 'CE'])
  })

  it('formats warranty, country of origin, shelf life, condition and audience', () => {
    const wo = (product: SpecSource, label: string) => valueOf(product, 'warranty', label)
    expect(wo({ warranty_months: 12, warranty_type: 'manufacturer' }, 'Warranty')).toBe('1 year (Manufacturer)')
    expect(wo({ warranty_months: 24 }, 'Warranty')).toBe('2 years')
    expect(wo({ warranty_months: 6 }, 'Warranty')).toBe('6 months')
    expect(wo({ warranty_months: 1 }, 'Warranty')).toBe('1 month')
    expect(wo({ warranty_type: 'seller' }, 'Warranty')).toBeUndefined()
    expect(wo({ country_of_origin: 'IN' }, 'Country of origin')).toBe('India')
    expect(wo({ country_of_origin: 'de' }, 'Country of origin')).toBe('Germany')
    expect(wo({ country_of_origin: 'India' }, 'Country of origin')).toBe('India')
    expect(wo({ shelf_life_days: 365 }, 'Shelf life')).toBe('1 year')
    expect(wo({ shelf_life_days: 730 }, 'Shelf life')).toBe('2 years')
    expect(wo({ shelf_life_days: 180 }, 'Shelf life')).toBe('6 months')
    expect(wo({ shelf_life_days: 30 }, 'Shelf life')).toBe('1 month')
    expect(wo({ shelf_life_days: 45 }, 'Shelf life')).toBe('45 days')
    expect(wo({ condition: 'new' }, 'Condition')).toBeUndefined()
    expect(wo({ condition: 'open_box' }, 'Condition')).toBe('Open Box')
    expect(wo({ age_min: 3, age_max: 12, target_gender: 'female', target_audience: ['Students'] }, 'Suitable for'))
      .toBe('3 to 12 years, Female, Students')
    expect(wo({ age_min: 14, target_gender: 'unisex' }, 'Suitable for')).toBe('14+ years')
    expect(wo({ age_max: 8 }, 'Suitable for')).toBe('Up to 8 years')
  })

  it('shows product codes with GTIN falling back to the barcode', () => {
    const codes = (product: SpecSource, label: string) => valueOf(product, 'codes', label)
    expect(codes({ barcode: '8901234567890' }, 'GTIN / EAN')).toBe('8901234567890')
    expect(codes({ gtin: '00012345600012', barcode: '8901234567890' }, 'GTIN / EAN')).toBe('00012345600012')
    expect(codes({ isbn: '9780131103627' }, 'ISBN')).toBe('9780131103627')
    expect(codes({ gst_percentage: '18.00' }, 'GST rate')).toBe('18%')
    expect(codes({ gst_percentage: '12.50' }, 'GST rate')).toBe('12.5%')
    expect(codes({ specifications: { hsn_code: '8207' } }, 'HSN code')).toBe('8207')
  })

  it('hides the MPN when it is the part number already shown', () => {
    const mpnRow = (product: SpecSource) => valueOf(product, 'codes', 'MPN')
    expect(mpnRow({ brand_part_number: 'GMF-912', mpn: 'gmf-912' })).toBeUndefined()
    expect(mpnRow({ mpn: 'TX-100' })).toBeUndefined()
    expect(valueOf({ mpn: 'TX-100' }, 'key-details', 'Part number')).toBe('TX-100')
    expect(mpnRow({ brand_part_number: 'GMF-912', mpn: 'TX-100' })).toBe('TX-100')
  })

  it('returns only the handling flags that are set', () => {
    expect(build({ fragile: true, hazardous: false, flammable: true, perishable: true }).handling)
      .toEqual(['fragile', 'flammable', 'perishable'])
    expect(build({ hazardous: true }).groups).toEqual([])
  })
})
